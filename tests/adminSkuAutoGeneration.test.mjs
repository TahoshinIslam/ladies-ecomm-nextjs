// Regression coverage for a real admin complaint: "Generate variants"
// always left every new row's SKU blank, requiring an admin to hand-type
// one per row (e.g. 12 SKUs for a 12-combination batch) — "the SKU should
// be auto generate based on the variant... it doesn't look systematically
// correct." components/admin/ProductFormModal.jsx now derives a
// deterministic SKU from the product name + that row's variant attributes
// instead, while leaving the field a plain editable <Input> (never
// disabled/read-only) so an admin can still override any specific row.
//
// The three pure helpers (skuSegment/productCodeFromName/generateVariantSku)
// are exported from that .jsx file, but this repo's plain `node:test`
// suite has no JSX transform (see tests/helpers/nextResolveHookImpl.mjs's
// own header — it only patches "next/*" module resolution for Route
// Handler tests, never JSX), so importing the component module directly
// isn't possible here. This is therefore a static-source check (same
// house style as tests/homeDepartmentGridOrder.test.mjs) proving the
// generation call is actually wired into generateVariants(), plus a
// same-file re-implementation of the exact algorithm (copied from the
// source, not re-derived independently) exercised against real cases —
// if the two ever drift, the wiring assertions below still catch a
// regression back to a blank/hardcoded sku.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

describe("components/admin/ProductFormModal.jsx — auto-generated variant SKUs", () => {
  const source = read("components/admin/ProductFormModal.jsx");

  test("generateVariants() calls generateVariantSku(...) for each new row's sku, not a hardcoded blank string", () => {
    assert.match(
      source,
      /newVariants\.push\(\{[\s\S]{0,200}sku:\s*generateVariantSku\(productName,\s*attributes\)/,
      "each generated row's sku must come from generateVariantSku(), not sku: \"\"",
    );
  });

  test("the SKU field stays a plain, editable Input — never disabled/read-only (an admin must still be able to override it)", () => {
    const skuInputMatch = source.match(/<Input label="SKU"[^/]*\/>/);
    assert.ok(skuInputMatch, "the SKU <Input> must still exist");
    assert.doesNotMatch(skuInputMatch[0], /disabled|readOnly/, "the SKU input must remain editable");
  });

  test("duplicateVariant() still clears sku (a duplicated row needs its own new SKU, never a copy of the original's)", () => {
    assert.match(source, /insertVariant\(index \+ 1, \{ \.\.\.src,[\s\S]{0,80}sku:\s*""/);
  });
});

describe("Reimplementation of the exported SKU-generation algorithm (copied from source; behavioral regression coverage)", () => {
  // Copied verbatim from components/admin/ProductFormModal.jsx — kept in
  // sync manually since that file can't be imported here (see header).
  const SKU_STOPWORDS = new Set(["the", "a", "an", "of", "and", "for", "with"]);
  function skuSegment(value) {
    const cleaned = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return cleaned.slice(0, 4) || "XXX";
  }
  function productCodeFromName(name) {
    const words = String(name || "")
      .trim()
      .split(/[\s-]+/)
      .filter((w) => w && !SKU_STOPWORDS.has(w.toLowerCase()));
    if (!words.length) return "SKU";
    const initials = words
      .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0])
      .filter(Boolean)
      .join("")
      .toUpperCase();
    return initials.slice(0, 6) || "SKU";
  }
  function generateVariantSku(productName, attributes) {
    const base = productCodeFromName(productName);
    const segments = Object.values(attributes || {}).map(skuSegment);
    return [base, ...segments].join("-");
  }

  test("a realistic product name + attributes produce a stable, readable SKU", () => {
    assert.equal(
      generateVariantSku("Saudi-Style Closed Burqa", { color: "black", fabric: "nida", size: "free-size" }),
      "SSCB-BLAC-NIDA-FREE",
    );
  });

  test("two different colors of the same product get distinct SKUs sharing the same product prefix", () => {
    const black = generateVariantSku("Saudi-Style Closed Burqa", { color: "black" });
    const navy = generateVariantSku("Saudi-Style Closed Burqa", { color: "navy" });
    assert.notEqual(black, navy);
    assert.ok(black.startsWith("SSCB-") && navy.startsWith("SSCB-"));
  });

  test("an empty/untyped product name still produces a usable SKU (SKU-<segment>), never a blank string", () => {
    const sku = generateVariantSku("", { color: "black" });
    assert.equal(sku, "SKU-BLAC");
  });

  test("a stopword ('The', 'A', ...) in the product name is excluded from the initials", () => {
    assert.equal(productCodeFromName("The Modest Set"), "MS");
  });
});
