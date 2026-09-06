// Phase 3: production rate limiting.
//
// WHY MONGODB, NOT REDIS: this codebase previously had `config/redis.js`,
// `app/middleware/rateLimiter.js`, and `utlis/cache.js` from before the
// App Router migration, all referencing Redis — but the `redis` package
// was never in package.json's dependencies at all, `express-rate-limit`
// and `rate-limit-redis` (imported by the old rateLimiter.js) were also
// never installed, and that file even imported a `../utils/logger.js`
// that never existed anywhere in the repository. None of those three
// files were imported by anything else (confirmed by a repo-wide grep at
// the time), and all three were confirmed dead and removed in Phase 6.
// Redis was never installed, configured, or connected, and therefore was
// never this application's real rate-limit backend. Per the Phase 3
// instructions, this is instead a fresh, narrowly-scoped module built on
// the MongoDB infrastructure this codebase already tests against — not a
// reuse of that (now-removed) dead Express middleware, and not a new
// service dependency installed just to look more sophisticated.
//
// WHY THIS WORKS ACROSS MULTIPLE INSTANCES: every counter lives in the
// shared MongoDB database every Node/serverless instance already connects
// to (see config/db.js) — there is no in-memory Map, no module-global
// counter, no per-process state of any kind. Two requests landing on two
// different instances (or two different serverless invocations) both
// increment the SAME document via the SAME atomic MongoDB operation.
//
// WHY IT'S ATOMIC UNDER CONCURRENCY: each check is a single
// `findOneAndUpdate` with `$inc` and `upsert: true` — MongoDB serializes
// concurrent writes to the same document at the storage-engine level, so
// two simultaneous requests in the same window always produce two
// distinct, correctly-ordered increments (1-then-2, never a lost update).
// The one race MongoDB itself does not fully protect against is the very
// FIRST insert of a brand-new window from two concurrent requests, which
// can raise a duplicate-key error (E11000) against the unique
// {keyHash, action, windowStart} index on one of the two callers — that
// is caught below and retried as a plain increment against the
// now-existing document, which then proceeds atomically like any other.
//
// WHY CORRECTNESS DOESN'T DEPEND ON TTL CLEANUP: windowStart is a
// deterministic function of the current time and the window size
// (Math.floor(now / windowMs) * windowMs) — the moment a new window
// begins, every request computes a brand-new windowStart value and thus
// targets a brand-new document. The OLD window's row becomes irrelevant
// to every future check instantly, whether or not MongoDB's background
// TTL sweep has actually deleted it yet (see models/rateLimitModel.js).

import crypto from "crypto";

import RateLimitCounter from "../models/rateLimitModel.js";

// Duck-typed by `err.name` in lib/http.js's toResponse() (the same pattern
// already used there for CastError/ValidationError) — avoids a circular
// import between this file and lib/http.js.
export class RateLimitStoreError extends Error {
  constructor(message) {
    super(message);
    // A class extending Error does NOT get its class name as `.name`
    // automatically — it stays "Error" unless set explicitly. Without
    // this, lib/http.js's `err.name === "RateLimitStoreError"` check
    // would never match and every store failure would fall through to a
    // generic 500 instead of the documented fail-closed 503.
    this.name = "RateLimitStoreError";
  }
}

/**
 * Thrown (Phase 3B) by an IP-only-limited route (register, reset-password)
 * when NODE_ENV=production and lib/clientIp.js's requireClientIp()
 * reports no trustworthy client IP is available — the fail-closed policy
 * for a route with no OTHER rate-limit dimension to fall back on. Never
 * thrown outside production (see requireClientIp()'s own doc comment).
 * Same generic 503 response shape as RateLimitStoreError, kept as a
 * separate class only for test clarity — the client cannot and must not
 * be able to distinguish the two.
 */
export class ClientIpUnavailableError extends Error {
  constructor() {
    super("Service temporarily unavailable, please try again shortly");
    this.name = "ClientIpUnavailableError";
  }
}

/** Thrown by enforceRateLimit() when a check is over its limit. Carries the exact integer Retry-After value the response must send. */
export class RateLimitExceededError extends Error {
  constructor(retryAfterSeconds) {
    super("Too many requests, please try again later");
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/** Lowercased, trimmed — so "Foo@Example.com " and "foo@example.com" share one bucket, closing the case/whitespace bypass. */
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** For non-email identities (an IP address) — trimmed only, no case-folding (IPv6 case doesn't carry the same bypass risk emails do, and lower-casing an IP is meaningless). */
export function normalizeIdentifier(raw) {
  return String(raw || "").trim();
}

/**
 * Validates a rate-limit config value from the environment. Rejects zero,
 * negative, NaN, non-finite, and absurdly large values — falling back to
 * the caller-supplied, code-reviewed default rather than silently
 * accepting a misconfigured environment.
 */
export function resolveBoundedInt(envValue, defaultValue, { max = 1_000_000 } = {}) {
  const n = Number(envValue);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > max) return defaultValue;
  return n;
}

/**
 * One atomic check-and-increment for a fixed window. Returns a structured
 * result — never throws for "the caller is over the limit" (that's just
 * `allowed: false`); only throws RateLimitStoreError for a genuine
 * database failure, which callers must handle explicitly (see each Route
 * Handler's own try/catch) — this function never silently treats a store
 * failure as "allowed".
 */
export async function checkRateLimit({ identity, action, limit, windowMs }) {
  const keyHash = sha256(identity);
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  // A little past the window's own end, so a request arriging right at
  // the boundary still finds a live (not-yet-TTL-swept) document; this is
  // a storage-reclamation backstop only, never relied on for correctness.
  const expiresAt = new Date(windowStart.getTime() + windowMs + 60_000);

  let doc;
  try {
    doc = await RateLimitCounter.findOneAndUpdate(
      { keyHash, action, windowStart },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true },
    );
  } catch (err) {
    if (err.code === 11000) {
      // Lost the race to create this window's first document — it exists
      // now (created by the concurrent request that won), so just
      // increment it like any other hit in this window.
      try {
        doc = await RateLimitCounter.findOneAndUpdate({ keyHash, action, windowStart }, { $inc: { count: 1 } }, { new: true });
      } catch (retryErr) {
        throw new RateLimitStoreError(retryErr.message);
      }
    } else {
      throw new RateLimitStoreError(err.message);
    }
  }

  const resetAt = new Date(windowStart.getTime() + windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000));

  return {
    allowed: doc.count <= limit,
    limit,
    remaining: Math.max(0, limit - doc.count),
    retryAfterSeconds,
    resetAt,
  };
}

/**
 * Runs every check and throws RateLimitExceededError on the first one that
 * fails, with that check's own retryAfterSeconds — used so a route can
 * enforce several independent dimensions (e.g. per-IP AND per-account) in
 * one call. Every check always runs (this function does not short-circuit
 * on the first store error either) so both counters are always
 * incremented consistently, matching what a real repeated request would
 * do. A RateLimitStoreError from ANY check propagates immediately and is
 * NEVER swallowed here — see each Route Handler's own comment on the
 * fail-closed policy for auth-sensitive endpoints.
 */
export async function enforceRateLimit(checks) {
  const results = await Promise.all(checks.map((c) => checkRateLimit(c)));
  const blocked = results.find((r) => !r.allowed);
  if (blocked) throw new RateLimitExceededError(blocked.retryAfterSeconds);
}
