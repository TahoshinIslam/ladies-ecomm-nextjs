// Phase 10 — App Router robots.txt (Next.js 16.3.4's `robots.js` file
// convention). A crawl-directive hint only — never a security boundary
// (every path listed here is already independently protected by real
// server-side authentication/authorization checks: lib/serverPageAuth.js
// 's redirect()s, app/admin/layout.js's staff-role gate, and each API
// route's own auth). Disallowing a path here stops well-behaved crawlers
// from indexing it; it does not and cannot stop a request from reaching
// it.
import { absoluteUrl } from "@/lib/seo.js";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/admin/",
          "/login",
          "/register",
          "/checkout",
          "/cart",
          "/orders",
          "/orders/",
          "/order-success/",
          "/profile",
          "/wishlist",
          "/compare",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
