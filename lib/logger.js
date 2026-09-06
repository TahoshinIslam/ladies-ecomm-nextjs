// Phase 11 — structured server-side logging with a strict field
// allowlist. Every call site passes a plain object; only the fields
// named in ALLOWED_FIELDS are ever serialized — anything else (a raw
// Error object, a Mongoose document, a request body, cookies) is
// silently dropped rather than accidentally logged, which is the
// opposite failure mode of a denylist (which only blocks fields someone
// remembered to list).
const ALLOWED_FIELDS = new Set([
  "timestamp",
  "level",
  "event",
  "requestId",
  "route",
  "method",
  "status",
  "durationMs",
  "category",
]);

// A bounded set of safe, non-specific failure categories — never a raw
// error message/class name, which could itself leak internal detail
// (a Mongoose validation message naming a field, a driver error naming
// a host). Extend this list deliberately, not by passing through
// whatever string happened to be on hand.
export const FAILURE_CATEGORIES = Object.freeze({
  VALIDATION: "validation",
  AUTH: "auth",
  NOT_FOUND: "not_found",
  RATE_LIMITED: "rate_limited",
  DEPENDENCY_UNAVAILABLE: "dependency_unavailable",
  TIMEOUT: "timeout",
  INTERNAL: "internal",
});

function redact(fields) {
  const out = {};
  for (const key of Object.keys(fields || {})) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    const value = fields[key];
    // Never let an object/array/Error slip through even under an
    // allowed key name — every allowed field is a primitive.
    if (value !== null && typeof value === "object") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Logs one structured, single-line JSON event to stdout/stderr (Vercel
 * captures both as function logs). Never throws — a logging failure must
 * never break the request it's describing.
 */
export function logEvent(fields) {
  const safe = redact(fields);
  safe.timestamp = safe.timestamp || new Date().toISOString();
  safe.level = safe.level || "info";
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(safe));
  } catch {
    // Never let a serialization edge case throw during request handling.
  }
}

// A bounded, safe request-id shape: a UUID (v4-ish) or a short
// alphanumeric token — long enough to disambiguate, short enough to
// never accidentally carry an embedded payload. Rejects anything with
// CRLF/control characters (header-injection) or unexpected length.
const SAFE_REQUEST_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * Resolves a request-correlation id: reuses an incoming platform-trusted
 * id (Vercel's own `x-vercel-id`) when it's shaped safely, else a fresh
 * random UUID. Never trusts an arbitrary client-supplied `x-request-id`
 * header for the SAME reason lib/clientIp.js doesn't trust an arbitrary
 * client-supplied IP header — a request id is used only for correlating
 * log lines, never for authorization, but accepting an attacker-chosen
 * value that isn't even shape-validated would let it inject control
 * characters into a log line.
 */
export function getOrCreateRequestId(request) {
  const platformId = request?.headers?.get?.("x-vercel-id");
  if (platformId && SAFE_REQUEST_ID_RE.test(platformId)) return platformId;
  return crypto.randomUUID();
}
