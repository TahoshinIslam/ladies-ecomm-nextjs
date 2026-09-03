// Server-side resolution of Bangla database content (Product.nameBn/
// descriptionBn, Category.nameBn/descriptionBn, AttributeDefinition.labelBn
// and its option/labelOverride labelBn — see models/*.js). Applied once at
// the API route boundary, right before the response is sent, so every
// consuming component just reads `product.name`/`category.name` as before
// and always gets the right-language value with zero component-level
// fallback logic. Services stay locale-agnostic and keep returning full
// bilingual data (the admin product/category forms need both fields to
// edit them) — only routes decide which language a given request sees.
import { isValidLocale, DEFAULT_LOCALE } from "./config.js";

const isBangla = (locale) => locale === "bn-BD";

// `doc` may be a Mongoose Document (getProductByIdOrSlug) or a plain
// lean()-ed object (CARD_FIELDS list queries) — .toObject() normalizes
// both to a plain object so the Bangla override is a real, safe patch
// rather than fighting a Document's internal getters.
const toPlain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

/**
 * Override each of `fields` with its `<field>Bn` counterpart when Bangla is
 * active and that Bangla value is non-empty. Falls back to the existing
 * English value otherwise — a document is never returned with a blank
 * title/description just because a translation hasn't been entered yet.
 */
export function localizeFields(doc, locale, fields) {
  if (!doc) return doc;
  const safeLocale = isValidLocale(locale) ? locale : DEFAULT_LOCALE;
  if (!isBangla(safeLocale)) return doc;

  const base = toPlain(doc);
  let changed = false;
  const patch = { ...base };
  for (const field of fields) {
    const bnValue = base[`${field}Bn`];
    if (bnValue) {
      patch[field] = bnValue;
      changed = true;
    }
  }
  return changed ? patch : base;
}

const PRODUCT_FIELDS = ["name", "description"];
const CATEGORY_FIELDS = ["name", "description"];

export const localizeProduct = (doc, locale) => localizeFields(doc, locale, PRODUCT_FIELDS);
export const localizeProductList = (list, locale) => (list || []).map((p) => localizeProduct(p, locale));

export const localizeCategory = (doc, locale) => localizeFields(doc, locale, CATEGORY_FIELDS);
export const localizeCategoryList = (list, locale) => (list || []).map((c) => localizeCategory(c, locale));

/**
 * AttributeDefinition needs its own shape: `label` at the top level, plus
 * per-option `label` (options[]) and per-category `label` (labelOverrides[])
 * — each with its own labelBn sibling (see models/attributeDefinitionModel.js).
 * `value` (the stable, filter-facing machine value) is never touched.
 */
export function localizeAttributeDefinition(doc, locale) {
  if (!doc) return doc;
  const safeLocale = isValidLocale(locale) ? locale : DEFAULT_LOCALE;
  if (!isBangla(safeLocale)) return doc;

  const base = toPlain(doc);
  return {
    ...base,
    label: base.labelBn || base.label,
    options: (base.options || []).map((o) => ({ ...o, label: o.labelBn || o.label })),
    labelOverrides: (base.labelOverrides || []).map((o) => ({ ...o, label: o.labelBn || o.label })),
  };
}

export const localizeAttributeDefinitionList = (list, locale) =>
  (list || []).map((d) => localizeAttributeDefinition(d, locale));
