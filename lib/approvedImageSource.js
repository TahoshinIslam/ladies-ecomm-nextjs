// Phase 9 checkpoint — a small, client-safe classifier for "can this URL
// actually render as an <Image>, both under next.config.mjs's
// images.remotePatterns AND under proxy.js's production CSP img-src?"
//
// Before this existed, three admin/review surfaces (branding-logo picker,
// user avatar, review-author avatar) kept a raw <img> specifically to
// handle an "arbitrary, unrestricted-origin URL" — reasoning that only
// checked next/image's own remotePatterns allowlist. That missed a real
// gap: proxy.js's CSP `img-src` is `'self' https://res.cloudinary.com data:
// blob:` (no bare `https:`/`*`) — a raw <img> pointed at any OTHER host
// was already silently blocked by the browser in production, whether or
// not it went through next/image. A raw <img> bought nothing for that
// case; it only avoided the render for HOSTS THAT WERE NEVER GOING TO
// RENDER ANYWAY.
//
// So the real, useful distinction is simply: is this URL one next/image
// can actually optimize (same-origin relative path, or a host declared in
// next.config.mjs's remotePatterns)? If yes, render it — real users on a
// real Cloudinary/placehold.co URL keep working exactly as before. If no,
// there is no working raw-<img> fallback to fall back TO (CSP already
// blocks it) — render the existing initials/icon placeholder instead,
// same as the "no avatar set" case. This function's list must stay in
// sync with next.config.mjs's images.remotePatterns AND proxy.js's CSP
// img-src — both currently agree on exactly `res.cloudinary.com`, plus
// `placehold.co` for next.config.mjs alone, which is safe to include here
// too because next/image never lets the browser request it directly (the
// browser only ever fetches next/image's own same-origin `/_next/image`
// endpoint, which satisfies CSP's `'self'` regardless of the upstream
// host next/image itself fetches from server-side).
const APPROVED_HOSTS = new Set(["res.cloudinary.com", "placehold.co"]);

export function isApprovedImageSource(src) {
  if (!src || typeof src !== "string") return false;
  if (src.startsWith("/") && !src.startsWith("//")) return true; // same-origin relative path
  try {
    const url = new URL(src);
    return url.protocol === "https:" && APPROVED_HOSTS.has(url.hostname);
  } catch {
    return false; // not a parseable absolute URL — never render it
  }
}
