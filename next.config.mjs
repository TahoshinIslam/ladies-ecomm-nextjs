import path from "node:path";

// Phase 3: global security headers that don't need a per-request nonce
// (the Content-Security-Policy header — which DOES need one, since
// real, unavoidable inline <script> tags exist in every page's HTML; see
// proxy.js's own header comment for the built-output evidence — lives
// there instead, not here, so the two mechanisms never both try to set
// the same header on the same response).
//
// Phase 11 CI-verification fix: this file (unlike proxy.js's runtime
// middleware) is evaluated once, at `next build` time — its `headers()`
// config is baked into the build's routes manifest and never
// re-evaluated by `next start`. Previously this gated the HSTS header on
// `process.env.NODE_ENV === "production"` at that BUILD-TIME moment —
// but this app's own established invariant (see proxy.js's own comment)
// is that `next start` always serves as production regardless of
// whatever NODE_ENV the *build* happened to run under. The very first
// real GitHub Actions CI run for this repository caught the resulting
// bug directly: the workflow's job-level `NODE_ENV: test` (needed for
// config/db.js's test-database branch — see .github/workflows/ci.yml)
// meant `next build` there saw NODE_ENV=test, so this conditional never
// added the header at all — even though the exact same `next start`
// process it built was unconditionally serving as production. No local
// run had ever caught this, because no one had manually exported
// NODE_ENV=test before an ad-hoc `npm run build`. HSTS is now
// unconditional — sending it during `next dev` (plain HTTP) is inert
// (browsers only ever honor HSTS over a connection already secured by
// HTTPS), so there is no dev-workflow cost to removing the gate.
const securityHeaders = [
  // nosniff — stop a browser from ever guessing a response's MIME type
  // and executing it as something it wasn't served as.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the full referrer only to our own origin; other origins only get
  // the bare origin, never the full path/query (which could carry PII —
  // an order id, an email in a query string, etc.).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app never embeds itself or is meant to be embedded — belt and
  // suspenders alongside the CSP's own frame-ancestors 'none' (proxy.js),
  // for browsers that only understand the legacy header.
  { key: "X-Frame-Options", value: "DENY" },
  // Disable browser capabilities this app never uses. Deliberately not
  // X-XSS-Protection — that header is obsolete, ignored by every current
  // browser, and can itself introduce XSS vectors in old ones; a real CSP
  // (proxy.js) is the actual XSS defense.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()",
  },
];

// Deliberately conservative: no `includeSubDomains` and no `preload`,
// because this repository has no evidence about which subdomains exist
// or whether every one of them is HTTPS-only (no vercel.json, no
// DNS/deployment config committed here) — enabling either without that
// confirmation risks permanently locking browsers out of a subdomain
// that isn't actually HTTPS-capable yet (`preload` in particular is very
// hard to reverse once browsers have baked a domain into their preload
// list). This is a deployment decision for whoever owns the real
// production domain, not one this codebase can make on their behalf —
// see .env.example for the operator note.
securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray package-lock.json in the parent directory, which makes
  // Turbopack infer the workspace root incorrectly. Pin it to this project.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  images: {
    // Phase 9 — HTTPS-only, minimally scoped to the remote origins this
    // app actually serves images from.
    //
    // `res.cloudinary.com` is where an admin's own image uploads land
    // (services/uploadService.js). It can't be narrowed further to a
    // specific cloud-name path segment here: config/cloudinary.js
    // resolves the cloud name from CLOUDINARY_URL/CLOUDINARY_CLOUD_NAME
    // at runtime (it differs between local dev, CI/test, and
    // production), so a hostname-only pattern is the narrowest one that
    // stays correct in every environment without hardcoding an
    // environment-specific value into version-controlled config.
    //
    // `placehold.co` is the seed/demo catalog's original text-placeholder
    // image host (see IMG() in scripts/seedCatalog.mjs).
    //
    // `images.unsplash.com` was re-added here for the Cosmetics seed
    // products (Lipstick/Foundation) — real, free-license stock photos
    // instead of text placeholders. Re-remove this if those seed products
    // ever go back to placehold.co and nothing else references it.
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      {
        // Every route, including API routes and the 404 page — none of
        // these headers need the per-request nonce logic proxy.js's CSP
        // header does, so a single static rule here covers all of them.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
