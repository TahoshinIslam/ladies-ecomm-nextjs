import { NextResponse } from "next/server";
import crypto from "node:crypto";

// Phase 3: Content-Security-Policy. Next.js 16 renamed `middleware.js` to
// `proxy.js` (confirmed via node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// — the old name still works but is deprecated). This file replaces the
// nonexistent middleware.js this project never had.
//
// WHY A NONCE, NOT A STATIC 'unsafe-inline' POLICY: confirmed by actual
// built-output evidence, not assumed. `npm run build` followed by
// `next start` and curling a real page (e.g. /login) shows Next.js's App
// Router injects several genuinely inline <script> tags with no `src` —
// `(self.__next_f=self.__next_f||[]).push(...)` (the React Server
// Component streaming payload) and React's own `$RC`/`$RT`/`$RV` Suspense
// bootstrap scripts. These are load-bearing: the app cannot hydrate
// without them. A static CSP with `script-src 'self'` alone would break
// every page; adding `'unsafe-inline'` instead of a nonce would defeat
// the entire point of a script-src allowlist (any injected inline script
// would execute). The documented Next.js mechanism for this exact
// situation is a per-request nonce generated in proxy.js/middleware.js —
// see the "Nonces" section of the doc above.
//
// COST OF THIS CHOICE: nonce-based CSP requires every page to render
// dynamically (Next.js applies the nonce during server-side rendering,
// based on the CSP header on the incoming request — a statically
// generated page has no request to read a nonce from). Verified this
// costs NOTHING extra here: `npm run build`'s own route table already
// marks every single page in this app — not just the API routes — as
// "ƒ (Dynamic)", because the whole app already reads the session cookie
// (Phase 2) on effectively every route. There is no static/ISR page in
// this codebase today to lose.
//
// API routes get a separate, simpler, non-nonce CSP below — their
// responses are JSON, not HTML, so there is no inline script to allow in
// the first place; the policy there is defense-in-depth only.

const isDev = process.env.NODE_ENV === "development";

function buildPageCsp(nonce) {
  return [
    "default-src 'self'",
    // 'strict-dynamic' + a nonce is the modern strict-CSP pattern: any
    // script loaded BY a nonce'd script is automatically trusted, so
    // Next.js's own dynamically-loaded chunk scripts work without also
    // needing to be individually allowlisted by URL.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // 'unsafe-inline' here — narrowly justified, not a default reach:
    // real browser testing (not just inspecting server-rendered HTML)
    // caught actual CSP violations from framer-motion (used in 27
    // components throughout this app for animation) setting inline
    // `style="..."` attributes imperatively via JS to drive transforms/
    // opacity — this is fundamental to how the library animates, not
    // something a nonce can cover (nonces only apply to <style>/<link>
    // elements, never to an element's own `style` attribute) and not
    // something a fixed hash allowlist can cover either, since the exact
    // style string changes every animation frame. This is scoped to
    // style-src ONLY — script-src has no unsafe-inline/unsafe-eval in
    // production; a malicious inline STYLE cannot execute arbitrary JS,
    // which is why this specific, narrow exception does not undermine
    // the CSP's actual XSS defense.
    "style-src 'self' 'unsafe-inline'",
    // res.cloudinary.com: several components render raw <img src={...}>
    // pointing directly at Cloudinary-hosted product/upload images
    // (bypassing next/image's own same-origin optimization proxy) —
    // confirmed by inspecting components/admin/ImageDropzone.jsx,
    // components/product/CompareTray.jsx, and others. data:/blob: are
    // Next.js's own documented defaults for inline/placeholder images.
    "img-src 'self' https://res.cloudinary.com data: blob:",
    // next/font/google self-hosts the built font files under
    // /_next/static/media/ at build time (confirmed in the actual build
    // output) — no runtime request to fonts.gstatic.com ever happens.
    "font-src 'self'",
    // Every fetch() and EventSource() call in this codebase targets a
    // same-origin /api/* path (confirmed by a repo-wide search) — no
    // external API, analytics, or third-party connect target exists.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// API responses are JSON; there is no inline script to allow at all here.
// Still set a maximally restrictive policy as defense in depth in case a
// response is ever served with a content-type a browser chooses to
// interpret as HTML anyway.
const API_CSP = ["default-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");

export function proxy(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", API_CSP);
    return response;
  }

  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = buildPageCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Runs on every request EXCEPT static assets — those are served as-is
  // and don't need a CSP header on themselves, and running this on every
  // static chunk request would be pure overhead. Deliberately does NOT
  // exclude /api (unlike the doc's own suggested matcher) — API routes
  // still need the simpler CSP branch above.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
