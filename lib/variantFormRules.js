// Pure, framework-free variant rules shared by the admin product form
// (components/admin/ProductFormModal.jsx) and its tests. They mirror what the
// server enforces in services/productService.js — the form uses them only to
// show the problem next to the field; the server never trusts the form.

// Order-independent, case-insensitive identity of a variant's attribute
// values: {color:"Black",size:"40"} === {size:"40",color:"black"}.
// Blank values are ignored (a blank isn't a value). "[]" = no attributes.
export function attributeSignature(attrs) {
  return JSON.stringify(
    Object.entries(attrs || {})
      .filter(([, value]) => String(value ?? "").trim() !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value).trim().toLowerCase()]),
  );
}

// Finds duplicate SKUs (case-insensitive — the database's unique index is)
// and duplicate attribute combinations across the rows. Returns
// [{ index, field: "sku" | "variantName", message }].
export function findVariantRowProblems(variants) {
  const problems = [];
  const skus = new Map();
  const combos = new Map();
  (variants || []).forEach((v, index) => {
    const sku = String(v.sku ?? "").trim().toLowerCase();
    if (sku) {
      if (skus.has(sku)) problems.push({ index, field: "sku", message: `Duplicate SKU (also on row ${skus.get(sku) + 1})` });
      else skus.set(sku, index);
    }
    const sig = attributeSignature(v.attributes);
    if (sig !== "[]") {
      if (combos.has(sig)) problems.push({ index, field: "variantName", message: `Same combination as row ${combos.get(sig) + 1}` });
      else combos.set(sig, index);
    }
  });
  return problems;
}

// Required variant attributes (attribute definitions flagged `required`):
// [{ index, key, message }] for every row missing one.
export function findMissingRequiredAttributes(variants, variantAttrDefs) {
  const problems = [];
  (variants || []).forEach((v, index) => {
    for (const def of variantAttrDefs || []) {
      if (def.required && !String(v.attributes?.[def.key] ?? "").trim()) {
        problems.push({ index, key: def.key, message: `${def.label} is required` });
      }
    }
  });
  return problems;
}

// Only the current department's own variant fields, blanks dropped. Values
// typed under a previous department stay in form state (so switching back
// restores them) but are never sent.
export function pickApplicableAttributes(attrs, variantAttrDefs) {
  const allowed = new Set((variantAttrDefs || []).map((d) => d.key));
  return Object.fromEntries(
    Object.entries(attrs || {}).filter(([key, value]) => allowed.has(key) && String(value ?? "").trim() !== ""),
  );
}

// Attribute keys some variant carries a value for that the department doesn't use.
export function findUnsavedAttributeKeys(variants, variantAttrDefs) {
  const allowed = new Set((variantAttrDefs || []).map((d) => d.key));
  const keys = new Set();
  for (const v of variants || []) {
    for (const [key, value] of Object.entries(v.attributes || {})) {
      if (String(value ?? "").trim() !== "" && !allowed.has(key)) keys.add(key);
    }
  }
  return [...keys];
}
