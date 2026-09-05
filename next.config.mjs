import path from "node:path";

// Phase 3: global security headers that don't need a per-request nonce
// (the Content-Security-Policy header — which DOES need one, since
// real, unavoidable inline <script> tags exist in every page's HTML; see
// proxy.js's own header comment for the built-output evidence — lives
// there instead, not here, so the two mechanisms never both try to set
// the same header on the same response).
const isProd = process.env.NODE_ENV === "production";

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

if (isProd) {
  // PRODUCTION ONLY. Deliberately conservative: no `includeSubDomains` and
  // no `preload`, because this repository has no evidence about which
  // subdomains exist or whether every one of them is HTTPS-only (no
  // vercel.json, no DNS/deployment config committed here) — enabling
  // either without that confirmation risks permanently locking browsers
  // out of a subdomain that isn't actually HTTPS-capable yet (`preload`
  // in particular is very hard to reverse once browsers have baked a
  // domain into their preload list). This is a deployment decision for
  // whoever owns the real production domain, not one this codebase can
  // make on their behalf — see .env.example for the operator note.
  securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray package-lock.json in the parent directory, which makes
  // Turbopack infer the workspace root incorrectly. Pin it to this project.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
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
