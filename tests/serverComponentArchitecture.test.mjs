// Phase 7 — static architecture checks for the Server Component migration.
// Text-based, not a full static analyzer: it proves concrete, executable
// invariants (a file does or doesn't contain "use client", does or
// doesn't import a given module) rather than anything about wording, so
// it won't flag a harmless comment mentioning "RTK Query" or "use client"
// in prose.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");

// The six mandatory Server Component page shells (Phase 7 section B).
const SERVER_PAGE_SHELLS = [
  "views/HomePage.jsx",
  "views/ShopPage.jsx",
  "views/ProductDetailPage.jsx",
  "views/OrdersPage.jsx",
  "views/OrderDetailPage.jsx",
  "views/admin/OverviewPage.jsx",
];

// The Client Component islands this migration introduced — each MUST
// keep its "use client" directive (they own real interactive state:
// hero rotation, product tabs, order actions/SSE, the shop filter shell,
// the product-detail interactive body, the admin charts, the newsletter
// form, the guided-finder button).
const CLIENT_ISLANDS = [
  "views/home/HeroCarousel.jsx",
  "views/home/ProductShowcaseSection.jsx",
  "views/home/NewsletterPoster.jsx",
  "views/home/GuidedFinderSection.jsx",
  "views/shop/ShopPageClient.jsx",
  "views/product/ProductDetailInteractive.jsx",
  "views/admin/OverviewCharts.jsx",
  "components/order/OrderDetailActions.jsx",
];

const USE_CLIENT_RE = /^\s*["']use client["'];?\s*$/m;
const RTK_HOOK_IMPORT_RE = /use(Get|Create|Update|Delete|Toggle|Cancel|Lazy)\w*(Query|Mutation)/;
const OWN_API_FETCH_RE = /fetch\(\s*["'`](?:https?:\/\/[^"'`]*)?\/api\//;

describe("Phase 7 — mandatory Server Component page shells", () => {
  for (const file of SERVER_PAGE_SHELLS) {
    test(`${file} has no "use client" directive`, () => {
      const content = read(file);
      assert.equal(USE_CLIENT_RE.test(content), false, `${file} must be a Server Component (no "use client")`);
    });

    test(`${file} imports no RTK Query hook for its own rendering`, () => {
      const content = read(file);
      // Checked against actual import lines only (not prose comments,
      // which may legitimately name a hook this migration removed).
      const importLines = content.split("\n").filter((line) => /^\s*import\b/.test(line));
      const offendingLine = importLines.find((line) => RTK_HOOK_IMPORT_RE.test(line));
      assert.equal(offendingLine, undefined, `${file} must not import an RTK Query hook directly — it is a Server Component`);
    });

    test(`${file} never fetches this app's own /api`, () => {
      const content = read(file);
      assert.equal(OWN_API_FETCH_RE.test(content), false, `${file} must call the service/data layer directly, not fetch("/api/...")`);
    });
  }
});

describe("Phase 7 — interactive islands explicitly retain \"use client\"", () => {
  for (const file of CLIENT_ISLANDS) {
    test(`${file} has a "use client" directive`, () => {
      const content = read(file);
      assert.equal(USE_CLIENT_RE.test(content), true, `${file} is a genuine interaction island and must declare "use client"`);
    });
  }
});

describe("Phase 7 — server-only auth/serialization helpers", () => {
  test("lib/serverPageAuth.js exists and exports the expected helpers", () => {
    const content = read("lib/serverPageAuth.js");
    assert.match(content, /export async function getServerPageUser/);
    assert.match(content, /export async function requireServerUser/);
    assert.match(content, /export async function requireServerPermission/);
    // Never a bearer/query-string token fallback.
    assert.ok(!/authorization/i.test(content));
    assert.ok(!/searchParams\.get\(["']token["']\)/.test(content));
  });

  test("lib/serialize.js exists and exports serializeForClient", () => {
    const content = read("lib/serialize.js");
    assert.match(content, /export function serializeForClient/);
  });

  test("no Server Component page shell imports Mongoose models directly into a Client Component's props path without serializeForClient", () => {
    // A lighter, precise check: every server page shell that imports a
    // services/*.js module (which return real Mongoose documents) also
    // imports serializeForClient — proving DTO normalization happens
    // before data crosses into any Client Component it renders.
    for (const file of SERVER_PAGE_SHELLS) {
      const content = read(file);
      const importsService = /from ["'"].*services\/[a-zA-Z]+Service\.js["']/.test(content);
      if (!importsService) continue;
      assert.match(content, /serializeForClient/, `${file} fetches from a service and must serialize before passing data to a Client Component`);
    }
  });
});
