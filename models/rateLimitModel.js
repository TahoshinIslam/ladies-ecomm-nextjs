import mongoose from "mongoose";

// MongoDB-backed, atomic, fixed-window rate-limit counters — used in place
// of Redis (see lib/rateLimit.js's own header comment for why: Redis is
// not installed/configured/connected anywhere in this codebase, and Phase
// 3 explicitly forbids claiming Redis protection that doesn't exist).
//
// Never stores a raw IP address, email, session token, reset token, or
// coupon code — only `keyHash`, a SHA-256 hash of the normalized identity
// string. A stolen database dump therefore reveals no usable identity, the
// same defense-in-depth principle Phase 2's Session model already applies.
const rateLimitSchema = new mongoose.Schema(
  {
    // SHA-256 hash of the normalized identity (lowercased/trimmed email,
    // or the trusted client IP) — never the raw value itself.
    keyHash: { type: String, required: true },
    // A short, fixed action name (e.g. "login:ip", "login:account") —
    // keeps one identity's buckets for different endpoints independent.
    action: { type: String, required: true },
    // Deterministic fixed-window start (Math.floor(now / windowMs) *
    // windowMs) — NOT a rolling/sliding window. A new window is a NEW
    // document with a NEW windowStart value, so correctness never depends
    // on the old window's row having been deleted yet (TTL cleanup is a
    // storage-reclamation backstop only, exactly like Phase 2's Session
    // TTL index — see lib/rateLimit.js's own comment).
    windowStart: { type: Date, required: true },
    count: { type: Number, required: true, default: 0 },
    // TTL backstop cleanup — set a little past windowStart + windowMs so a
    // request arriving right at the boundary still sees a live document.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

// One counter per (identity, action, window) — the atomic upsert in
// lib/rateLimit.js relies on this to make concurrent first-requests-in-a-
// new-window converge on a single document rather than each creating their
// own duplicate counter.
rateLimitSchema.index({ keyHash: 1, action: 1, windowStart: 1 }, { unique: true });

const RateLimitCounter = mongoose.models.rate_limit_counters || mongoose.model("rate_limit_counters", rateLimitSchema);
export default RateLimitCounter;
