// Phase 3C: the client-IP trust boundary for rate limiting — now bound to
// a CONFIRMED production platform (Vercel; the operator confirmed
// tahosstore.vercel.app is the real deployment for this closure), with a
// separate, explicitly-opt-in generic reverse-proxy mode preserved for any
// other self-hosted deployment.
//
// ============================================================================
// VERCEL PATH (primary — used whenever process.env.VERCEL === "1")
// ============================================================================
//
// Uses the OFFICIAL @vercel/functions `ipAddress(request)` helper — not a
// manually-selected X-Forwarded-For hop. Verified directly against the
// published package source (@vercel/functions@3.9.5, the version this
// repo pins) rather than assumed from prose docs:
//
//   const IP_HEADER_NAME = "x-real-ip";
//   function ipAddress(input) {
//     const headers = "headers" in input ? input.headers : input;
//     return getHeader(headers, IP_HEADER_NAME); // returns undefined if absent
//   }
//
// So `ipAddress()` reads ONLY `x-real-ip` and does NO format validation of
// its own — this file validates the result with Node's built-in
// `net.isIP()` (an authoritative parser, not a custom regex) before
// trusting it as an identity.
//
// WHY THIS IS SAFE FROM CLIENT SPOOFING — quoted directly from Vercel's
// own official docs (vercel.com/docs/headers/request-headers, `x-forwarded-for`
// section, current as of this closure):
//
//   "If you are trying to use Vercel behind a proxy, we currently
//   overwrite the X-Forwarded-For header and do not forward external
//   IPs. This restriction is in place to prevent IP spoofing."
//
// The same page states `x-real-ip` "is identical to the x-forwarded-for
// header" — so it inherits the same guarantee: Vercel's edge network sets
// this header itself on every request, discarding whatever value (if any)
// the client supplied, UNLESS the account has purchased Vercel's
// Enterprise "Trusted Proxy" add-on to explicitly allow a custom
// X-Forwarded-For from a proxy the customer put in front of Vercel — not
// applicable to this deployment; not assumed here.
//
// ============================================================================
// GENERIC REVERSE-PROXY PATH (fallback — only when NOT on Vercel)
// ============================================================================
//
// For any other self-hosted deployment. Requires EXPLICIT production
// configuration (TRUST_PROXY_HEADERS=true + a validated
// TRUSTED_PROXY_HOP_COUNT) and remains fully disabled otherwise — see the
// original Phase 3/3B header comment reasoning, preserved below. This
// path is NEVER consulted when process.env.VERCEL === "1"; Vercel
// deployments always use the official resolver above, never a manually
// guessed hop count.
//
// IMPORTANT OPERATIONAL CAVEAT: `process.env.VERCEL` is only populated
// when the Vercel project has "Enable access to System Environment
// Variables" turned on (Project Settings → Environment Variables) — this
// is Vercel's own default-recommended setting, but if it is ever turned
// off, this file has no way to detect it is running on Vercel and will
// fall through to the generic path (disabled by default), which means
// requireClientIp() will fail closed for register/reset-password in
// production. This is documented in .env.example.
//
// ============================================================================
// DEPENDENCY INJECTION (Phase 3C, test-only)
// ============================================================================
//
// getClientIp() accepts an optional `{ ipAddressFn }` override so tests
// can exercise the Vercel-path SELECTION/VALIDATION logic (invalid
// output, missing output, IPv4/IPv6 handling) without needing to actually
// run inside Vercel's infrastructure. Production code never passes this
// option — every real route call uses the default, which is the real,
// official `ipAddress` import. See tests/rateLimit.test.mjs for the
// injected-fake-provider tests and tests/http/clientIpTrust.integration.test.mjs
// for the generic-proxy-mode real-HTTP tests (this harness doesn't run on
// Vercel, so its real-HTTP coverage exercises the generic path).

import net from "node:net";
import { ipAddress as vercelIpAddress } from "@vercel/functions";

const truthy = (v) => v === "true" || v === "1";

export function isVercelRuntime() {
  return process.env.VERCEL === "1";
}

export function isProxyTrustEnabled() {
  return truthy(process.env.TRUST_PROXY_HEADERS);
}

/**
 * A configured-but-invalid hop count (not a positive integer) is treated
 * as MISCONFIGURED, not defaulted to 1 — silently guessing a hop count
 * risks selecting an attacker-controlled entry from X-Forwarded-For as if
 * it were the trusted one, which is worse than refusing to guess at all.
 * Returns null when misconfigured; callers must treat that as "no trusted
 * IP available," identical to trust being disabled outright.
 */
function configuredHopCount() {
  const raw = process.env.TRUSTED_PROXY_HOP_COUNT;
  if (raw === undefined) return 1; // default: exactly one trusted proxy
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Node's own authoritative IP parser — returns 4, 6, or 0 (invalid). Used instead of a custom shape regex, for both the Vercel and generic paths. */
function isValidIp(value) {
  return typeof value === "string" && value.length > 0 && net.isIP(value) !== 0;
}

function getGenericProxyClientIp(request) {
  if (!isProxyTrustEnabled()) return null;

  const hops = configuredHopCount();
  if (hops === null) return null; // misconfigured hop count — never guess

  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return null;

  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < hops) return null;

  const ip = parts[parts.length - hops];
  return isValidIp(ip) ? ip : null;
}

/**
 * Returns the trusted client IP for rate-limiting identity, or null if:
 *   - on Vercel: the official resolver returned nothing, or returned
 *     something that isn't a syntactically valid IP.
 *   - off Vercel: generic proxy trust isn't configured, the hop count is
 *     misconfigured, the header is absent/too-short, or the entry at the
 *     trusted position isn't a valid IP.
 * Never throws. This function alone does NOT decide fail-open vs
 * fail-closed — see requireClientIp() below for the routes that need
 * that decision.
 *
 * `ipAddressFn` — TEST-ONLY override of the Vercel resolver (see the
 * file-level "DEPENDENCY INJECTION" comment above). Never passed by
 * production route code.
 */
export function getClientIp(request, { ipAddressFn = vercelIpAddress } = {}) {
  if (isVercelRuntime()) {
    const ip = ipAddressFn(request);
    return isValidIp(ip) ? ip : null;
  }
  return getGenericProxyClientIp(request);
}

/**
 * For routes whose ONLY rate-limit dimension is IP (register,
 * reset-password) — where a null identity would mean the route runs
 * completely unprotected, not just "less precisely protected." Returns:
 *   - { ok: true, identity: <ip> } — a real, trusted IP was resolved
 *     (Vercel's official resolver, or a correctly-configured generic
 *     proxy).
 *   - { ok: true, identity: null } — non-production only: the caller
 *     should skip the IP dimension for this request (test/dev
 *     convenience, never reachable in a real deployment).
 *   - { ok: false } — production, and no trustworthy IP is available
 *     (unrecognized platform, Vercel misconfigured to hide system env
 *     vars, or a self-hosted deployment that hasn't configured generic
 *     proxy trust). The caller MUST fail closed (503), never proceed
 *     unprotected and never fall back to a shared identity.
 */
export function requireClientIp(request, options) {
  const ip = getClientIp(request, options);
  if (ip) return { ok: true, identity: ip };
  if (process.env.NODE_ENV === "production") return { ok: false, identity: null };
  return { ok: true, identity: null };
}
