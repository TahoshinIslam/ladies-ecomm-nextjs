// Phase 11 (closing a Phase 10 carryover) — safe client-side error-boundary
// logging. The previous policy (`console.error("...", error?.digest ||
// error)`) meant that whenever no digest existed — the normal case for a
// Client Component error, which never gets a digest, only Server
// Component errors do — the FULL Error object (message, stack, and
// anything else attached to it) was logged straight to the browser
// console in production. That's browser-side logging, not server
// operational logging, and it directly contradicts this app's own
// "never disclose internal error detail" policy applied everywhere else
// (see app/error.jsx's/app/admin/error.jsx's own header comments).
//
// This function logs, at most, a fixed event name plus the opaque
// digest (safe to log alone — it's a correlation hash, not the error
// itself). In development only, it also logs the real error object to
// help local debugging — gated on NODE_ENV, never shipped to a
// production browser console.
export function logClientErrorSafely(eventName, error) {
  if (error?.digest) {
    // eslint-disable-next-line no-console
    console.error(eventName, { digest: error.digest });
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(eventName, error);
  }
}
