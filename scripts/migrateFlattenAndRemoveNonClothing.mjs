// One-off migration: this shop is clothing-only now. Removes the
// Cosmetics/Shoes/Sunglasses departments (and every product under them)
// entirely, and un-nests Burqa/Hijab/Niqab/Abaya/Khimar/Modest-Sets/
// T-Shirt/Shirts/Jeans back to top-level departments (parent: null),
// removing the now-pointless single-purpose "Clothes" division wrapper.
//
// Modes:
//   node scripts/migrateFlattenAndRemoveNonClothing.mjs            (dry-run
//                                                    default — no writes)
//   node scripts/migrateFlattenAndRemoveNonClothing.mjs --apply    (real
//                                                    writes, transactional)
//
// Safety:
//   - Dry-run by default; --apply is required for any write.
//   - The real --apply write is wrapped in a single Mongo transaction —
//     either everything commits or nothing does.
//   - Idempotent: safe to re-run. If Cosmetics/Shoes/Sunglasses/Clothes
//     are already gone, the plan is empty and --apply is a no-op.
//   - Never logs the connection string — only a redacted host/database.
//   - No product/category _id ever changes — only `parent` fields on the
//     Clothes-division departments, plus whole-document deletes for the
//     categories/products/attribute-definition entries being removed.
import mongoose from "mongoose";

import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";

const REMOVED_DEPARTMENT_SLUGS = ["cosmetics", "shoes", "sunglasses"];
const CLOTHES_SLUG = "clothes";

function redact(uri) {
  if (typeof uri !== "string") return "(unknown)";
  return uri.replace(/\/\/[^@]+@/, "//<redacted>@");
}

function resolveUri() {
  const uri = process.env.NODE_ENV === "test" ? process.env.MONGO_URI_TEST : process.env.MONGO_URI;
  if (!uri) {
    throw new Error(`${process.env.NODE_ENV === "test" ? "MONGO_URI_TEST" : "MONGO_URI"} is not set`);
  }
  return uri;
}

async function buildPlan() {
  const clothes = await Category.findOne({ slug: CLOTHES_SLUG }).lean();
  const removedDepts = await Category.find({ slug: { $in: REMOVED_DEPARTMENT_SLUGS }, parent: null }).lean();

  const removedDeptIds = removedDepts.map((d) => d._id);
  const removedDescendants = removedDeptIds.length
    ? await Category.find({ parent: { $in: removedDeptIds } }).lean()
    : [];
  const removedCategoryIds = [...removedDeptIds, ...removedDescendants.map((c) => c._id)];

  const productsToDelete = removedDeptIds.length
    ? await Product.find({ topCategory: { $in: removedDeptIds } }).select("_id name topCategory").lean()
    : [];

  const clothesChildren = clothes ? await Category.find({ parent: clothes._id }).lean() : [];

  // "color" applies to clothing AND the removed departments (Shoes/
  // Sunglasses) — strip the removed ids from its appliesToCategories
  // rather than deleting the whole attribute (clothing still needs it).
  // "shade"/"volumeMl"/"skinType" apply ONLY to Cosmetics — delete those
  // definitions entirely.
  const colorAttr = await AttributeDefinition.findOne({ key: "color" }).lean();
  const colorAppliesToRemoved = (colorAttr?.appliesToCategories || []).filter((id) =>
    removedDeptIds.some((rid) => String(rid) === String(id)),
  );
  const cosmeticsOnlyAttrs = await AttributeDefinition.find({ key: { $in: ["shade", "volumeMl", "skinType"] } }).lean();

  return {
    clothes,
    removedDepts,
    removedDescendants,
    removedCategoryIds,
    productsToDelete,
    clothesChildren,
    colorAttr,
    colorAppliesToRemoved,
    cosmeticsOnlyAttrs,
  };
}

function printPlan(plan) {
  console.log("--- Migration plan ---");
  console.log(`Clothes division: ${plan.clothes ? `found (${plan.clothes._id})` : "not found (already flat, or never existed)"}`);
  console.log(`Departments to remove: ${plan.removedDepts.map((d) => d.slug).join(", ") || "(none)"}`);
  console.log(`Categories to delete (departments + their leaves): ${plan.removedCategoryIds.length}`);
  console.log(`Products to delete: ${plan.productsToDelete.length}`);
  for (const p of plan.productsToDelete) console.log(`  - ${p.name} (${p._id})`);
  console.log(
    `Departments to re-parent to root: ${plan.clothesChildren.map((c) => c.slug).join(", ") || "(none)"}`,
  );
  console.log(
    `"color" attribute: ${plan.colorAppliesToRemoved.length ? `will drop ${plan.colorAppliesToRemoved.length} removed-department id(s) from appliesToCategories` : "no change needed"}`,
  );
  console.log(
    `Cosmetics-only attribute definitions to delete: ${plan.cosmeticsOnlyAttrs.map((a) => a.key).join(", ") || "(none)"}`,
  );
  console.log("----------------------");
}

async function applyPlan(plan, session) {
  if (plan.productsToDelete.length) {
    await Product.deleteMany(
      { _id: { $in: plan.productsToDelete.map((p) => p._id) } },
      { session },
    );
  }
  if (plan.removedCategoryIds.length) {
    await Category.deleteMany({ _id: { $in: plan.removedCategoryIds } }, { session });
  }
  for (const child of plan.clothesChildren) {
    await Category.updateOne({ _id: child._id }, { $set: { parent: null } }, { session });
  }
  if (plan.clothes) {
    await Category.deleteOne({ _id: plan.clothes._id }, { session });
  }
  if (plan.colorAppliesToRemoved.length) {
    await AttributeDefinition.updateOne(
      { key: "color" },
      { $pull: { appliesToCategories: { $in: plan.colorAppliesToRemoved } } },
      { session },
    );
  }
  if (plan.cosmeticsOnlyAttrs.length) {
    await AttributeDefinition.deleteMany(
      { _id: { $in: plan.cosmeticsOnlyAttrs.map((a) => a._id) } },
      { session },
    );
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = resolveUri();

  mongoose.set("strictQuery", true);
  const conn = await mongoose.connect(uri, { autoIndex: false });
  console.log(`Connected: ${redact(uri)} (db: ${conn.connection.name})`);

  try {
    const plan = await buildPlan();
    printPlan(plan);

    const isEmpty =
      !plan.clothes &&
      plan.removedDepts.length === 0 &&
      plan.productsToDelete.length === 0 &&
      plan.cosmeticsOnlyAttrs.length === 0 &&
      plan.colorAppliesToRemoved.length === 0;

    if (isEmpty) {
      console.log("Nothing to do — already migrated.");
      return;
    }

    if (!apply) {
      console.log("Dry run only — no writes made. Re-run with --apply to execute.");
      return;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => applyPlan(plan, session));
      console.log("Applied successfully.");
    } finally {
      await session.endSession();
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Migration failed:", err?.message || err);
    process.exit(1);
  });
}

export { buildPlan, applyPlan };
