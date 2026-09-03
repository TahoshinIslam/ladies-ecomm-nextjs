import { doubleCsrf } from "csrf-csrf";
import crypto from "crypto";

let csrfSecret = process.env.CSRF_SECRET;
if (!csrfSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("CSRF_SECRET env var is required in production");
  }
  // Generate a random fallback for development so the app doesn't crash
  csrfSecret = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[csrfMiddleware] WARNING: CSRF_SECRET not set. Using a random fallback for development. " +
      "Add CSRF_SECRET to your .env file to avoid this warning.",
  );
}

const isProd = process.env.NODE_ENV === "production";

// Paths that bypass CSRF:
//  - Stripe webhook: comes from Stripe server, not a browser. Has its own signature verification.
//  - Auth endpoints where the user doesn't have a session yet: login, register, forgot-password,
//    reset-password, verify-email. These use rate limiting + credential checks for protection.
//  - GET/HEAD/OPTIONS: CSRF only guards state-changing methods.
const EXEMPT_PATHS = [
  "/api/payments/stripe/webhook",
  "/api/users/login",
  "/api/users/register",
  "/api/users/forgot-password",
  "/api/users/verify-email",
];
// Reset-password uses POST /api/users/reset-password/:token — match by prefix
const EXEMPT_PREFIXES = ["/api/users/reset-password/"];

const isExempt = (req) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  if (EXEMPT_PATHS.includes(req.path)) return true;
  return EXEMPT_PREFIXES.some((p) => req.path.startsWith(p));
};

const { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError } =
  doubleCsrf({
    getSecret: () => csrfSecret,
    // Critical: the ID must match something stable per session. We use the user's
    // JWT cookie value when present, otherwise the session is anonymous.
    getSessionIdentifier: (req) => req.cookies?.jwt || "anonymous",
    cookieName: isProd ? "__Host-psifi.x-csrf-token" : "psifi.x-csrf-token",
    cookieOptions: {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      path: "/",
    },
    size: 64,
    getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"],
  });

// Wrapper that skips exempt paths
export const csrfProtection = (req, res, next) => {
  if (isExempt(req)) return next();
  return doubleCsrfProtection(req, res, next);
};

export const csrfTokenHandler = (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
};

export { invalidCsrfTokenError };
