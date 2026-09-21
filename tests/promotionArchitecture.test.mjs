// Admin-promotions feature — static source checks for the requirements
// that don't need a real database or a real browser: bundling (the popup
// is a dynamic-import island, not part of the critical initial bundle),
// accessibility markup shape, LCP/priority discipline on the carousel, and
// that audience/session data never leaks into the shared promotion cache.
// Same house style as this repo's other "*Architecture.test.mjs" files.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

// Strips comments before a literal-string count check, matching
// tests/imageOptimization.test.mjs's own precedent — this file's prose
// legitimately quotes `fetchPriority="high"` to explain the convention,
// which a naive count would double-count as a real occurrence.
const stripComments = (content) => content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Popup is a dynamically-imported client island, never in the critical bundle", () => {
  test("StorefrontShell.jsx imports CampaignPopup.jsx via next/dynamic with ssr:false, same as the other overlays", () => {
    const content = read("components/layout/StorefrontShell.jsx");
    assert.match(content, /dynamic\(\(\) => import\("@\/components\/layout\/CampaignPopup\.jsx"\), \{ ssr: false \}\)/);
  });

  test("CampaignPopup.jsx is mounted inside StorefrontShell.jsx's render tree", () => {
    const content = read("components/layout/StorefrontShell.jsx");
    assert.match(content, /<CampaignPopup\s*\/>/);
  });

  // This used to read app/admin/layout.jsx and assert it did not render
  // StorefrontShell, which is how the popup was kept out of the admin area.
  // There is no admin area in this app any more, so the property now holds
  // for a stronger reason: the only tree that mounts CampaignPopup is the
  // storefront shell, and that is asserted directly above.
});

describe("Campaign popup excludes sensitive storefront routes by default", () => {
  const content = read("components/layout/CampaignPopup.jsx");
  for (const route of ["/checkout", "/login", "/register", "/forgot-password", "/reset-password", "/order-success"]) {
    test(`excludes ${route}`, () => {
      assert.ok(content.includes(`"${route}"`), `CampaignPopup.jsx must list ${route} in its exclusion prefixes`);
    });
  }
});

describe("Campaign popup accessibility and behavior contract (Modal.jsx already provides focus trap/Escape/restore — reused, not reimplemented)", () => {
  const content = read("components/layout/CampaignPopup.jsx");

  test("reuses the shared Modal component rather than a bespoke dialog implementation", () => {
    assert.match(content, /import Modal from ["']\.\.\/ui\/Modal\.jsx["']/);
    assert.match(content, /<Modal\b/);
  });

  test("the popup delay is clamped to the documented 500-10000ms bounds client-side, defense in depth against the server value", () => {
    assert.match(content, /Math\.min\(10000,\s*Math\.max\(500,/);
  });

  test("a failed popup fetch is caught and never throws — must not block navigation", () => {
    assert.match(content, /\.catch\(/);
  });

  test("exactly one fetch(...) call site — any duplicate network requests observed in `next dev` are React StrictMode's dev-only double-effect-invocation, not a real duplicate-call bug (StrictMode doesn't run in a production build)", () => {
    const fetchCalls = [...content.matchAll(/\bfetch\(/g)];
    assert.equal(fetchCalls.length, 1, "expected exactly one fetch() call site in the whole component");
  });
});

describe("lib/promotionFrequency.js stores only the minimal, non-PII fields the spec allows", () => {
  const content = read("lib/promotionFrequency.js");

  test("every storage write is wrapped in try/catch (storage-unavailable safety)", () => {
    const writeFns = content.match(/function write\w+\([\s\S]*?\n}/g) || [];
    assert.ok(writeFns.length > 0);
    for (const fn of writeFns) assert.match(fn, /try\s*{/);
  });

  test("never references anything PII-shaped (email, name, token, session id) OUTSIDE its own explanatory comments", () => {
    // Strips // line comments and /* */ block comments before checking —
    // this file's own prose (correctly) explains what it does NOT store,
    // which mentions "session token" by name; the invariant that actually
    // matters is that no CODE path reads/writes one, not that the word
    // never appears in an English sentence anywhere in the file.
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(codeOnly, /email|password|\btoken\b|sessionId|userId/i);
  });

  test("the stored state shape is limited to version/lastShownAt/dismissedAt", () => {
    assert.match(content, /version:\s*promotion\.version/);
    assert.match(content, /lastShownAt:\s*Date\.now\(\)/);
    assert.match(content, /dismissedAt:\s*Date\.now\(\)/);
  });
});

describe("HeroCarousel.jsx — priority fetching is scoped to the one currently-mounted slide, never every slide at once", () => {
  const content = read("views/home/HeroCarousel.jsx");

  // See tests/imageOptimization.test.mjs's own updated comment for the
  // full reasoning this matches: AnimatePresence's `mode="wait"` ensures
  // only one slide (and its desktop+mobile Image pair) is ever mounted at
  // a time, so an unconditional fetchPriority="high" on the active
  // slide's own images is this codebase's established, tested convention
  // for this specific single-mount-at-a-time carousel shape — NOT the
  // same thing as ProductCard.jsx's index-conditional guard, which exists
  // because a product grid renders many cards simultaneously.
  test("both breakpoint images on the active slide use the established fetchPriority=\"high\" convention, not Next's `priority` prop", () => {
    const matches = [...stripComments(content).matchAll(/fetchPriority="high"/g)];
    assert.equal(matches.length, 2, "expected exactly two real fetchPriority=\"high\" occurrences — the active slide's desktop and mobile Image");
  });

  test("never uses loading=\"eager\" (fetchPriority=\"high\" is this codebase's documented substitute)", () => {
    assert.doesNotMatch(content, /loading="eager"/);
  });

  test("carousel controls carry real aria-labels (prev/next/pause) and aria-pressed on the pause toggle", () => {
    assert.match(content, /aria-label=\{t\("home\.heroPrevSlide"\)\}/);
    assert.match(content, /aria-label=\{t\("home\.heroNextSlide"\)\}/);
    assert.match(content, /aria-pressed=\{userPaused\}/);
  });

  test("the auto-advance timer respects prefers-reduced-motion", () => {
    assert.match(content, /prefers-reduced-motion/);
  });

  test("a non-clickable slide (targetType 'none') renders as a plain element, never an invalid nested link", () => {
    assert.match(content, /const Wrapper = active\.clickable \? Link : "div";/);
  });

  test("desktop and mobile use separate <Image> elements with distinct sizes, not one image stretched across breakpoints", () => {
    const imageBlocks = content.match(/<Image\b[\s\S]*?\/>/g) || [];
    assert.equal(imageBlocks.length, 2, "expected exactly one desktop and one mobile <Image>");
    assert.ok(imageBlocks.some((b) => /sm:block/.test(b)));
    assert.ok(imageBlocks.some((b) => /sm:hidden/.test(b)));
  });

  test("falls back to the department rotation when no promotions are eligible — never renders a broken/empty hero", () => {
    assert.match(content, /buildFallbackSlides\(departments, heroImageBySlug, heroFramingBySlug\)/);
  });
});

describe("views/HomePage.jsx — audience filtering happens outside the shared cache, per request", () => {
  const content = read("views/HomePage.jsx");

  test("calls getServerPageUser() (a live, per-request session read) alongside the cached promotions fetch", () => {
    assert.match(content, /getServerPageUser\(\)/);
  });

  test("filterByAudience() runs on the result AFTER the cached read, not inside it", () => {
    // Matches the actual CALL sites (a literal argument list follows),
    // not any mention of either name inside this file's own explanatory
    // comments — a naive whole-file indexOf would find prose about "the
    // filterByAudience() call below" before the real call.
    const cacheCallIndex = content.indexOf('getCachedEligiblePromotions("carousel"');
    const filterCallIndex = content.indexOf("filterByAudience(carouselPromotionsBase");
    assert.ok(cacheCallIndex > -1, "expected a real getCachedEligiblePromotions('carousel', ...) call");
    assert.ok(filterCallIndex > -1, "expected a real filterByAudience(carouselPromotionsBase, ...) call");
    assert.ok(filterCallIndex > cacheCallIndex, "filterByAudience must be called after the cached fetch resolves, not baked into it");
  });
});

describe("lib/serverDataCache.js's promotion cache wrapper never touches session/cookie/auth state", () => {
  test("getCachedEligiblePromotions's own function body never reads a session, cookie, or request object", () => {
    const content = read("lib/serverDataCache.js");
    const fnMatch = content.match(/export async function getCachedEligiblePromotions[\s\S]*?\n}/);
    assert.ok(fnMatch, "getCachedEligiblePromotions must exist in lib/serverDataCache.js");
    assert.doesNotMatch(fnMatch[0], /getSessionUser|getServerPageUser|cookies\(|request\.headers/);
  });
});

describe("Promotion permissions", () => {
  test("PROMOTIONS_MANAGE is a real permission string, not reusing an unrelated one", () => {
    const content = read("lib/permissions.js");
    assert.match(content, /PROMOTIONS_MANAGE:\s*"promotions\.manage"/);
  });

  // The ADMIN_NAV assertion that sat here read components/admin/adminNav.js.
  // Navigation is the dashboard's concern now. The permission string is
  // still this app's, because its promotion routes still name it — and the
  // test below still checks that they do.


  test("the public carousel/popup routes never require a permission — they must stay public", () => {
    for (const file of ["app/api/promotions/carousel/route.js", "app/api/promotions/popup/route.js"]) {
      const content = read(file);
      assert.doesNotMatch(content, /requirePermission|requireAdmin/, `${file} must stay public, unauthenticated-readable`);
    }
  });
});

describe("Public promotion DTO never leaks internal/admin-only fields", () => {
  test("toPublicDto() in services/promotionService.js only returns the documented public-safe field set", () => {
    const content = read("services/promotionService.js");
    const fnMatch = content.match(/function toPublicDto[\s\S]*?\n}/);
    assert.ok(fnMatch);
    // Checks for the field appearing as an OUTPUT KEY (`name:`) in the
    // returned object literal, not merely as a substring anywhere in the
    // function body — `promotion._id` and `promotion.targetType` are
    // legitimately READ from the source document to build the safe `id`/
    // `clickable` output fields; that is not the same as being LEAKED.
    for (const forbidden of ["createdBy", "updatedBy", "targetProduct", "targetCategory", "targetUrl"]) {
      assert.doesNotMatch(fnMatch[0], new RegExp(`\\b${forbidden}:`), `toPublicDto()'s returned object must never have a "${forbidden}" key`);
    }
    assert.doesNotMatch(fnMatch[0], /\b_id:/, 'toPublicDto()\'s returned object must expose "id", never the raw "_id" key');
  });
});

describe("schemas/promotionSchemas.js stays client-safe (importable from a Client Component)", () => {
  test("never imports mongoose, models/*, or any Node-only module", () => {
    const content = read("schemas/promotionSchemas.js");
    assert.doesNotMatch(content, /from ["']mongoose["']/);
    assert.doesNotMatch(content, /from ["']\.\.\/models\//);
    assert.doesNotMatch(content, /from ["']node:/);
  });
});
