import AttributeDefinition from "../models/attributeDefinitionModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

const WRITABLE_FIELDS = [
  "key",
  "label",
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
  return AttributeDefinition.find().sort("sortOrder key");
}

// The one resolver shared by the admin product form (now) and the
// storefront filter panel (Phase 3): which attributes apply to a given
// top-level category, with each one's display label already resolved via
// labelOverrides — e.g. "size" reads as "Length" for Burqa/Khimar.
export async function resolveAttributesForCategory(topCategoryId) {
  const defs = await AttributeDefinition.find({
    $or: [{ appliesToCategories: { $size: 0 } }, { appliesToCategories: topCategoryId }],
  })
    .sort("sortOrder key")
    .lean();

  return defs.map((def) => {
    const override = def.labelOverrides?.find(
      (o) => String(o.category) === String(topCategoryId),
    );
    return { ...def, label: override?.label ?? def.label };
  });
}

export async function createAttribute(body) {
  const data = pickWritable(body);
  if (!data.key || !data.label || !data.type) {
    throw new HttpError(400, "key, label, and type are required");
  }
  const attribute = await AttributeDefinition.create(data);
  return attribute;
}

export async function updateAttribute(id, body) {
  requireObjectIdFormat(id, "id");
  const attribute = await AttributeDefinition.findById(id);
  if (!attribute) throw new HttpError(404, "Attribute not found");

  const data = pickWritable(body);
  // Key is a stable reference used by Product.attributes[].key — changing
  // it after products exist would silently orphan their facet data.
  delete data.key;
  Object.assign(attribute, data);
  await attribute.save();
  return attribute;
}

export async function deleteAttribute(id) {
  requireObjectIdFormat(id, "id");
  const attribute = await AttributeDefinition.findById(id);
  if (!attribute) throw new HttpError(404, "Attribute not found");
  await attribute.deleteOne();
}
