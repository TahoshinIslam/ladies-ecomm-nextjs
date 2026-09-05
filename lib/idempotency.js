import crypto from "crypto";

import { HttpError } from "./http.js";

// Conservative accepted format (Phase 4 spec): 16-128 ASCII characters,
// letters/digits/hyphen/underscore only. This also happens to reject the
// combined multi-header-value case for free — the Fetch/Headers spec joins
// repeated header instances with ", ", and a comma+space is never valid
// here, so `request.headers.get()` returning a joined string fails the
// pattern and comes back as a plain 400 rather than silently picking one.
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// Deliberately case-sensitive header lookup via Headers#get, which is
// itself case-insensitive per the Fetch spec — no need to check variants.
export function readIdempotencyKey(request) {
  const raw = request.headers.get("idempotency-key");
  if (!raw) throw new HttpError(400, "Idempotency-Key header is required");
  if (!KEY_PATTERN.test(raw)) {
    throw new HttpError(
      400,
      "Idempotency-Key must be 16-128 characters of letters, digits, hyphens, or underscores",
    );
  }
  return raw;
}

// Never log or persist the raw key — only its hash. SHA-256 is one-way and
// fixed-length, so the DB index/comparison never sees the original value.
export function hashToken(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

// Recursively sorts object keys so the JSON serialization below doesn't
// depend on insertion order. Arrays keep their (already-normalized) order
// since order there is business-meaningful (caller must normalize it).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

// Deterministic fingerprint of the business-relevant fields of a create-
// order request — excludes CSRF/session/timestamps/random values and the
// Idempotency-Key itself, per the Phase 4 request-fingerprint contract.
// Line items are sorted by product+variant so item submission order (which
// carries no business meaning) doesn't change the fingerprint, but a
// genuinely different quantity/product/variant/address/coupon/tier/notes
// does.
export function fingerprintOrderRequest({ items, shippingAddress, shippingTier, couponCode, notes }) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((it) => ({
      productId: String(it?.productId ?? ""),
      variantId: String(it?.variantId ?? ""),
      quantity: Number(it?.quantity) || 0,
    }))
    .sort((a, b) => `${a.productId}:${a.variantId}`.localeCompare(`${b.productId}:${b.variantId}`));

  const normalizedAddress = shippingAddress
    ? {
        fullName: String(shippingAddress.fullName ?? "").trim(),
        phone: String(shippingAddress.phone ?? "").trim(),
        street: String(shippingAddress.street ?? "").trim(),
        city: String(shippingAddress.city ?? "").trim(),
        state: String(shippingAddress.state ?? "").trim(),
        postalCode: String(shippingAddress.postalCode ?? "").trim(),
        country: String(shippingAddress.country ?? "").trim(),
      }
    : null;

  const payload = canonicalize({
    items: normalizedItems,
    shippingAddress: normalizedAddress,
    shippingTier: String(shippingTier ?? "").trim(),
    couponCode: String(couponCode ?? "").trim().toUpperCase(),
    notes: String(notes ?? "").trim(),
  });

  return hashToken(JSON.stringify(payload));
}

// Duck-types a Mongoose/MongoDB duplicate-key error for a specific unique
// index field, without needing to import mongodb's driver error class here.
export function isDuplicateKeyError(err, field) {
  return err?.code === 11000 && Object.prototype.hasOwnProperty.call(err.keyPattern || {}, field);
}
