// The admin product form's variant validation (lib/variantFormRules.js — pure,
// so it can be exercised directly) plus static wiring checks on the form
// component itself (this suite has no JSX transform — same house style as
// tests/adminSkuAutoGeneration.test.mjs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  attributeSignature,
  findVariantRowProblems,
  findMissingRequiredAttributes,
  pickApplicableAttributes,
  findUnsavedAttributeKeys,
} from "../lib/variantFormRules.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const shoeDefs = [
  { key: "color", label: "Color", required: false },
  { key: "shoeSize", label: "Size", required: true },
];

describe("variant rows: duplicate SKUs and duplicate combinations", () => {
  test("flags a repeated SKU on the later row only, case-insensitively, naming the earlier row", () => {
    const problems = findVariantRowProblems([
      { sku: "NK-1", attributes: { color: "black", shoeSize: "40" } },
      { sku: "nk-1 ", attributes: { color: "black", shoeSize: "41" } },
      { sku: "NK-3", attributes: { color: "brown", shoeSize: "40" } },
    ]);
    assert.deepEqual(problems, [{ index: 1, field: "sku", message: "Duplicate SKU (also on row 1)" }]);
  });

  test("Black/40, Black/41, Brown/40 are all distinct; Black/40 twice is not (order and case don't matter)", () => {
    const ok = findVariantRowProblems([
      { sku: "a", attributes: { color: "Black", shoeSize: "40" } },
      { sku: "b", attributes: { color: "Black", shoeSize: "41" } },
      { sku: "c", attributes: { color: "Brown", shoeSize: "40" } },
    ]);
    assert.deepEqual(ok, []);
    const dup = findVariantRowProblems([
      { sku: "a", attributes: { color: "Black", shoeSize: "40" } },
      { sku: "b", attributes: { shoeSize: "40", color: "black" } },
    ]);
    assert.deepEqual(dup.map((p) => [p.index, p.field]), [[1, "variantName"]]);
  });

  test("blank SKUs and attribute-less rows are not reported as duplicates (their own 'required' errors cover them)", () => {
    assert.deepEqual(findVariantRowProblems([{ sku: "", attributes: {} }, { sku: "", attributes: {} }]), []);
    assert.equal(attributeSignature({ color: "", size: "  " }), "[]");
  });
});

describe("required variant attributes", () => {
  test("reports every row missing a required attribute, using the department's own label", () => {
    const problems = findMissingRequiredAttributes(
      [{ attributes: { color: "black", shoeSize: "40" } }, { attributes: { color: "black" } }, { attributes: { shoeSize: "  " } }],
      shoeDefs,
    );
    assert.deepEqual(problems.map((p) => [p.index, p.key, p.message]), [
      [1, "shoeSize", "Size is required"],
      [2, "shoeSize", "Size is required"],
    ]);
  });
});

describe("changing the department: nothing is silently discarded, nothing stale is saved", () => {
  const rows = [{ attributes: { color: "black", size: "M", shoeSize: "40" } }];

  test("only the current department's fields are sent; blanks dropped", () => {
    assert.deepEqual(pickApplicableAttributes({ color: "black", size: "M", shoeSize: "40", fabric: "" }, shoeDefs), { color: "black", shoeSize: "40" });
  });

  test("values belonging to other departments are surfaced (so the form can warn) rather than dropped silently", () => {
    assert.deepEqual(findUnsavedAttributeKeys(rows, shoeDefs), ["size"]);
    assert.deepEqual(findUnsavedAttributeKeys(rows, [...shoeDefs, { key: "size" }]), []);
  });
});

// The admin-side wiring block that used to live here checked how
// components/admin/ProductFormModal.jsx consumed these rules. That form now
// lives in the admin dashboard, which tests its own product form directly
// rather than by reading this app's source. What stays is the part that was
// always this app's: the rules themselves.
