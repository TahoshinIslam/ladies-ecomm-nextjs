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

describe("components/admin/ProductFormModal.jsx wiring", () => {
  const src = read("components/admin/ProductFormModal.jsx");

  test("loads the selected department's attribute definitions and renders one field per variant attribute (no hard-coded color/size)", () => {
    assert.match(src, /useGetAttributesQuery\(department,\s*\{\s*skip:\s*!department\s*\}\)/);
    assert.match(src, /variantAttrDefs\.map\(\(def\) => \(\s*<ComboField/);
    assert.doesNotMatch(src, /register\(`variants\.\$\{i\}\.attributes\.(color|size)`\)/, "fields must come from definitions, not literals");
  });

  test("submits each existing variant's _id so an edit updates it instead of replacing it", () => {
    assert.match(src, /_id: v\._id/, "existing variants seed their _id into the form");
    assert.match(src, /variantFields\[i\]\?\._id/);
    assert.match(src, /\.\.\.\(existingId \? \{ _id: existingId \} : \{\}\)/);
  });

  test("a duplicated variant row is a NEW variant (no _id)", () => {
    assert.match(src, /insertVariant\(index \+ 1, \{ \.\.\.src, _id: undefined,/);
  });

  test("uses the shared rules for duplicate SKU / required attributes / applicable attributes, and refuses to save before attributes load", () => {
    assert.match(src, /findVariantRowProblems\(data\.variants\)/);
    assert.match(src, /findMissingRequiredAttributes\(data\.variants, variantAttrDefs\)/);
    assert.match(src, /pickApplicableAttributes\(v\.attributes, variantAttrDefs\)/);
    assert.match(src, /if \(!attrData\) \{[\s\S]{0,200}return;/);
  });

  test("stock can't be left empty (z.coerce.number('') would silently be 0) and must be a non-negative whole number", () => {
    assert.match(src, /stock: z\.preprocess\(/);
    assert.match(src, /\.int\("Whole number only"\)\.min\(0/);
  });

  test("existing per-color photos are kept on edit (falls back to the variants' own images)", () => {
    assert.match(src, /images: swatchValue \? imagesForColor\(swatchValue\) : v\.images \|\| \[\]/);
    assert.doesNotMatch(src, /colorImages\[swatchValue\] \|\| \[\]/);
  });

  test("every variant input has a visible label (a11y) and the add/remove controls are real buttons", () => {
    for (const label of ['label="Variant name"', 'label="SKU"', 'label="Stock"', 'label="Price override"']) assert.ok(src.includes(label), label);
    assert.match(src, /<label htmlFor=\{inputId\}/, "ComboField labels are bound to their inputs");
    assert.match(src, /type="button"[\s\S]{0,400}Add variant manually/);
    assert.match(src, /aria-label="Select variant for bulk edit"/);
  });

  test("responsive: variant rows collapse to one column on small screens", () => {
    assert.match(src, /grid gap-2 sm:grid-cols-3/);
    assert.match(src, /grid gap-2 sm:grid-cols-2/);
  });
});

describe("the server-side schema mirrors the same variant contract", () => {
  test("variant _id is accepted; attributes are an open, definition-driven bag (blank values dropped); stock is a bounded non-negative int", async () => {
    const { createProductSchema } = await import("../schemas/catalogSchemas.js");
    const base = {
      name: "Shoe", description: "d", category: "6aabced3ed73918e10f6ff88", basePrice: 10, images: ["https://x.test/a.png"],
    };
    const parsed = createProductSchema.parse({
      ...base,
      variants: [{ _id: "6aabced3ed73918e10f6ff89", variantName: "v", sku: "S1", attributes: { color: " black ", shoeSize: "40", fabric: "" }, stock: 3 }],
    });
    assert.deepEqual(parsed.variants[0].attributes, { color: "black", shoeSize: "40" });
    assert.equal(parsed.variants[0]._id, "6aabced3ed73918e10f6ff89");
    for (const stock of [-1, 1.5, "3", 2_000_000]) {
      assert.equal(createProductSchema.safeParse({ ...base, variants: [{ variantName: "v", sku: "S1", stock }] }).success, false, String(stock));
    }
  });

  test("the attribute schema accepts what the admin Attributes form sends (labelBn, boolean derivedFromVariant)", async () => {
    const { createAttributeSchema, updateAttributeSchema } = await import("../schemas/catalogSchemas.js");
    const body = { key: "shoeSize", label: "Size", labelBn: "সাইজ", type: "select", options: [], appliesToCategories: [], filterable: true, required: false, derivedFromVariant: true, sortOrder: 0 };
    assert.equal(createAttributeSchema.safeParse(body).success, true);
    const { key, ...update } = body;
    assert.equal(updateAttributeSchema.safeParse(update).success, true);
    assert.equal(createAttributeSchema.safeParse({ ...body, derivedFromVariant: "yes" }).success, false);
  });
});
