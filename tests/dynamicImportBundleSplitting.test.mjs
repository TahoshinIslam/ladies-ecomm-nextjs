// Performance audit — build-artifact regression coverage for the two
// next/dynamic code-split boundaries introduced in this pass:
// components/layout/StorefrontShell.jsx's five overlays (Cart/Search/
// QuickAdd/Finder/Compare — closed by default, shown nothing until
// opened) and views/admin/ProductsPage.jsx's ProductFormModal (only
// rendered once an admin opens "New product"/edits a row). Both are
// wrapped in `next/dynamic(() => import(...), { ssr: false })`.
//
// Verified empirically before writing this: a real `next build`'s
// per-route `page_client-reference-manifest.js` (the file Next uses to
// track which Client Components a route's server-rendered tree actually
// references) does NOT list an `ssr:false` dynamically-imported component
// among its `clientModules` at all — it has no server-rendered output to
// track. A component that were still statically imported WOULD appear
// there (e.g. StorefrontShell.jsx and ProductsPage.jsx themselves both
// do). This is a stable, build-artifact-level signal — not a source-text
// regex — that a component is excluded from its route's eagerly
// server-referenced set, which is exactly what these two fixes did.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;

function readManifestModules(manifestRelPath) {
  const absPath = path.join(ROOT, manifestRelPath);
  if (!fs.existsSync(absPath)) return null;
  const sandbox = { self: {} };
  // The manifest file is a plain script that assigns to
  // `globalThis.__RSC_MANIFEST[...]` — evaluate it against an isolated
  // object instead of touching this test process's real globalThis.
  const code = fs.readFileSync(absPath, "utf8").replace(/globalThis/g, "self");
  new Function("self", code)(sandbox.self);
  const routeKey = Object.keys(sandbox.self.__RSC_MANIFEST)[0];
  return Object.keys(sandbox.self.__RSC_MANIFEST[routeKey].clientModules);
}

describe("Dynamic import / bundle-splitting regression (build artifacts)", () => {
  before(async () => {
    // A real build is required for these manifests to exist/be fresh —
    // same cost this repo already pays unconditionally for `test:http`
    // (its own pretest hook runs `npm run build` first).
    await execFileAsync("npm", ["run", "build"], { cwd: ROOT, timeout: 180_000 });
  });

  test("the storefront's per-route manifest never lists any of the 5 closed-by-default overlays as a tracked client module", () => {
    const modules = readManifestModules(".next/server/app/(routes)/page_client-reference-manifest.js");
    assert.ok(modules, "expected a fresh build to produce app/(routes)/page's client-reference-manifest");
    // StorefrontShell.jsx itself (which renders the dynamic() wrappers)
    // MUST still be tracked — proving this isn't just an empty/broken
    // manifest read.
    assert.ok(modules.some((m) => m.endsWith("components/layout/StorefrontShell.jsx")), "sanity check: StorefrontShell.jsx must still be a tracked client module");
    for (const overlay of ["CartDrawer.jsx", "SearchModal.jsx", "QuickAddSheet.jsx", "ProductFinder.jsx", "CompareTray.jsx"]) {
      assert.ok(
        !modules.some((m) => m.endsWith(overlay)),
        `${overlay} must NOT be a tracked client module of the home route — it must load only via its own dynamic() chunk when opened`,
      );
    }
  });

  test("/admin/products's manifest never lists ProductFormModal.jsx as a tracked client module", () => {
    const modules = readManifestModules(".next/server/app/admin/products/page_client-reference-manifest.js");
    assert.ok(modules, "expected a fresh build to produce app/admin/products/page's client-reference-manifest");
    assert.ok(modules.some((m) => m.endsWith("views/admin/ProductsPage.jsx")), "sanity check: ProductsPage.jsx must still be a tracked client module");
    assert.ok(
      !modules.some((m) => m.endsWith("ProductFormModal.jsx")),
      "ProductFormModal.jsx must NOT be a tracked client module of /admin/products — it must load only via its own dynamic() chunk when opened",
    );
  });

  test("both dynamic-import sites use { ssr: false } (never server-rendered, matching why they're absent from the manifests above)", () => {
    const shell = fs.readFileSync(path.join(ROOT, "components/layout/StorefrontShell.jsx"), "utf8");
    const productsPage = fs.readFileSync(path.join(ROOT, "views/admin/ProductsPage.jsx"), "utf8");
    for (const name of ["CartDrawer", "SearchModal", "QuickAddSheet", "ProductFinder", "CompareTray"]) {
      const re = new RegExp(`const ${name} = dynamic\\(\\(\\) => import\\([^)]*${name}[^)]*\\),\\s*\\{\\s*ssr:\\s*false\\s*\\}\\)`);
      assert.match(shell, re, `${name} must be dynamic-imported with ssr:false`);
    }
    assert.match(productsPage, /dynamic\(\(\)\s*=>\s*import\(["'][^"']*ProductFormModal\.jsx["']\),\s*\{\s*ssr:\s*false\s*,?\s*\}\)/);
  });
});
