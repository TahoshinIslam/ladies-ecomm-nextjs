// Phase 4B — the client's checkout-intent state machine, extracted into its
// own module (rather than left as inline CheckoutPage.jsx logic) so it can
// be unit-tested directly, with no React tree and no real browser
// sessionStorage, per tests/orderIdempotencyClient.test.mjs.
//
// A "checkout intent" is one customer's attempt to place one order. It
// survives BOTH network round trips checkout actually needs:
//   1. POST /api/orders        (mints/reuses an Idempotency-Key)
//   2. POST /api/payments/cod/[orderId]   (uses the orderId from step 1)
// A network failure, an ambiguous 5xx, or a page reload between those two
// steps must never cause a second Order to be created — resolveCheckoutIntent
// is what guarantees that: once `orderId` is set, it is returned as-is,
// unconditionally, regardless of any fingerprint drift (the cart being
// cleared by the just-created order is exactly that kind of drift).
//
// Every function here is pure or takes its I/O (`storage`) as a parameter —
// nothing reaches for `window`/`sessionStorage` globally — so tests can pass
// a plain in-memory Map-backed fake instead of a real browser API.

export const CHECKOUT_INTENT_VERSION = 1;

function storageKey(userId) {
  return `tahos:checkoutIntent:${userId}`;
}

// Deterministic client-side mirror of the server's own request fingerprint
// (services/orderService.js's fingerprintOrderRequest) — it does not need
// to match byte for byte, only to agree with itself about "did anything
// that would change the resulting order just change?"
export function computeCheckoutFingerprint({ items, shippingAddress, shippingTier, couponCode, notes }) {
  if (!shippingAddress) return null;
  const normalizedItems = (items || [])
    .map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity }))
    .sort((a, b) => `${a.productId}:${a.variantId}`.localeCompare(`${b.productId}:${b.variantId}`));
  return JSON.stringify({
    items: normalizedItems,
    address: {
      fullName: shippingAddress.fullName,
      phone: shippingAddress.phone,
      street: shippingAddress.street,
      city: shippingAddress.city,
      state: shippingAddress.state || "",
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country,
    },
    shippingTier: shippingTier || "",
    couponCode: couponCode || "",
    notes: notes || "",
  });
}

// A cryptographically-fine-for-this-purpose random key generator — the
// Idempotency-Key is not a credential, it just needs to be unique per
// checkout intent. Falls back to a non-crypto random string only in
// environments with no crypto.randomUUID (older browsers) — this callback
// is injectable specifically so tests can supply a deterministic one.
export function generateIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Reads and validates a stored intent. Never throws — any malformed JSON,
// unreadable storage, wrong schema version, or a record belonging to a
// different user (the storage key is already scoped per-user, but this is
// a second, independent guard against a stale/corrupted value) is treated
// as "nothing stored" and the bad entry is proactively removed so it can't
// keep failing the same way on every future call.
export function readStoredIntent(storage, userId) {
  if (!storage || !userId) return null;
  let raw;
  try {
    raw = storage.getItem(storageKey(userId));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStoredIntent(storage, userId);
    return null;
  }

  const valid =
    parsed &&
    typeof parsed === "object" &&
    parsed.version === CHECKOUT_INTENT_VERSION &&
    parsed.userId === userId &&
    typeof parsed.idempotencyKey === "string" &&
    parsed.idempotencyKey.length > 0 &&
    typeof parsed.fingerprint === "string" &&
    (parsed.orderId === null || typeof parsed.orderId === "string");

  if (!valid) {
    clearStoredIntent(storage, userId);
    return null;
  }
  return parsed;
}

export function writeStoredIntent(storage, intent) {
  if (!storage || !intent?.userId) return;
  try {
    storage.setItem(storageKey(intent.userId), JSON.stringify(intent));
  } catch {
    // Storage can throw (private browsing, quota) — the intent still works
    // for the rest of this in-memory session, it just won't survive reload.
  }
}

export function clearStoredIntent(storage, userId) {
  if (!storage || !userId) return;
  try {
    storage.removeItem(storageKey(userId));
  } catch {
    // Best-effort only.
  }
}

// The core decision: reuse the caller's in-flight intent, or mint a new
// one. Synchronous and side-effect-free apart from the one storage write
// when a fresh intent is minted — safe to call directly from an event
// handler (no useEffect timing dependency).
//
//   - An intent with an orderId already set is ALWAYS resumed as-is,
//     regardless of the current fingerprint — this is what makes a cart
//     that the just-created order already cleared not look like "the
//     payload changed" and mint a second, wrong intent/key.
//   - Otherwise, a stored intent whose fingerprint still matches the
//     current one is reused (safe to retry after an ambiguous network
//     failure with the SAME key).
//   - Otherwise (no stored intent, or the payload genuinely changed), a
//     fresh intent is minted and persisted.
//   - With no fingerprint and no resumable (orderId-bearing) intent, there
//     is nothing to place yet (e.g. no address selected) — returns null.
export function resolveCheckoutIntent({ storage, userId, fingerprint, generateKey = generateIdempotencyKey }) {
  if (!userId) return null;

  const stored = readStoredIntent(storage, userId);
  if (stored?.orderId) return stored;
  if (!fingerprint) return null;
  if (stored && stored.fingerprint === fingerprint) return stored;

  const fresh = {
    version: CHECKOUT_INTENT_VERSION,
    userId,
    idempotencyKey: generateKey(),
    fingerprint,
    orderId: null,
    state: "prepared",
  };
  writeStoredIntent(storage, fresh);
  return fresh;
}

// Called the instant POST /api/orders resolves (whether this request
// actually created the order, or replayed an existing one) — persists the
// orderId into the SAME intent record before the COD call is ever made, so
// a failure during COD never loses track of which order it belongs to.
export function markOrderCreated(storage, intent, orderId) {
  const updated = { ...intent, orderId, state: "order_created" };
  writeStoredIntent(storage, updated);
  return updated;
}

// The exact double-click guard views/CheckoutPage.jsx holds in a ref
// (`submitLockRef.current = createSubmitLock()`), extracted so it's
// independently testable. Deliberately NOT React state — `tryAcquire()`
// must be checked and set synchronously, in the same synchronous stretch
// of a click handler that runs before React commits any re-render, which
// is exactly what a ref (not state) guarantees.
export function createSubmitLock() {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

export function getBrowserSessionStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    // Some environments (sandboxed iframes with restrictive storage
    // policies) throw on the property access itself.
    return null;
  }
}
