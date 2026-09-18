// Phase 3: validated, bounded rate-limit configuration. Every value below
// is read from an environment variable with resolveBoundedInt() (see
// lib/rateLimit.js) — zero, negative, NaN, non-integer, or absurdly large
// values silently fall back to the documented default rather than being
// accepted. See .env.example / .env.test.example for the full list.

import { resolveBoundedInt } from "./rateLimit.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const LOGIN_IP_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_LOGIN_IP_MAX, 20, { max: 10_000 });
export const LOGIN_IP_WINDOW_MS = 15 * MINUTE;

// Deliberately HIGHER than models/userModel.js's own account-lockout
// threshold (5 failed attempts) — confirmed via a real test failure
// during this phase's own verification: with this set to 5, the rate
// limiter's generic 429 fired on the same (6th) request that should have
// produced lockout's specific 423, silently masking it. Lockout is the
// more specific, primary defense for repeated-password-guessing against
// ONE account; this limiter is a coarser backstop layered on top of it —
// setting them to the same threshold made the backstop fire first and
// hide the primary mechanism's own, more informative response. See
// tests/authLifecycle.test.mjs's lockout test and tests/rateLimit.test.mjs's
// "does not replace or break account lockout" test for the regression
// coverage that caught and now guards this.
export const LOGIN_ACCOUNT_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX, 10, { max: 10_000 });
export const LOGIN_ACCOUNT_WINDOW_MS = 15 * MINUTE;

export const REGISTER_IP_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_REGISTER_IP_MAX, 5, { max: 10_000 });
export const REGISTER_IP_WINDOW_MS = HOUR;

export const FORGOT_PASSWORD_IP_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_IP_MAX, 5, { max: 10_000 });
export const FORGOT_PASSWORD_IP_WINDOW_MS = 15 * MINUTE;

export const FORGOT_PASSWORD_ACCOUNT_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_ACCOUNT_MAX, 3, { max: 10_000 });
export const FORGOT_PASSWORD_ACCOUNT_WINDOW_MS = HOUR;

export const RESET_PASSWORD_IP_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_RESET_PASSWORD_IP_MAX, 10, { max: 10_000 });
export const RESET_PASSWORD_IP_WINDOW_MS = 15 * MINUTE;

export const COUPON_VALIDATE_USER_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_COUPON_VALIDATE_USER_MAX, 30, { max: 10_000 });
export const COUPON_VALIDATE_USER_WINDOW_MS = MINUTE;

// Order creation had no rate limit at all (confirmed audit finding). Set
// per-user, not per-IP — checkout is always authenticated. Deliberately
// generous relative to how many orders a genuine shopper could place in an
// hour, since this exists to stop scripted flooding, not to interfere with
// a real customer placing several legitimate separate orders. Critically,
// this limit is only ever consulted for a genuinely NEW order attempt —
// see createOrder()'s own comment: a request replaying an existing
// Idempotency-Key (a legitimate retry of the same order) resolves via the
// sequential-replay fast path BEFORE this limiter is ever checked, so
// retrying the same checkout never consumes a slot or gets blocked by it.
export const ORDER_CREATE_USER_LIMIT = resolveBoundedInt(process.env.RATE_LIMIT_ORDER_CREATE_USER_MAX, 20, { max: 10_000 });
export const ORDER_CREATE_USER_WINDOW_MS = HOUR;
