import AttributeDefinition from "../models/attributeDefinitionModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

const WRITABLE_FIELDS = [
  "key",
  "label",
  "labelBn",
  "labelOverrides",
  "type",
  "options",
  "appliesToCategories",
  "derivedFromVariant",
  "filterable",
  "required",
  "sortOrder",
];

const pickWritable = (body) => {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

// Full raw list — used by the Attributes admin CRUD page (needs the
// unresolved labelOverrides array to edit them) and, unfiltered, by anyone
// wanting every definition.
export async function listAttributes() {
  return AttributeDefinition.findAll();
}

// The one resolver shared by the admin product form (now) and the
// storefront filter panel (Phase 3): which attributes apply to a given
// top-level category, with each one's display label already resolved via
// labelOverrides — e.g. "size" reads as "Length" for Burqa/Khimar.
export async function resolveAttributesForCategory(topCategoryId) {
  const defs = await AttributeDefinition.findByCategoryOrGlobal(topCategoryId);

  return defs.map((def) => {
    const override = def.labelOverrides?.find(
      (o) => String(o.category) === String(topCategoryId),
    );
    return { ...def, label: override?.label ?? def.label };
  });
}




