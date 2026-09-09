// Adds a real 3rd category tier under Cosmetics — Face / Eyes / Lips /
// Skin — re-parenting the existing Lipstick/Foundation/Facewash leaves
// under the appropriate new tier, plus one new representative attribute
// ("finish") scoped to the new tiers. No product or category `_id` ever
// changes here — only the `parent` field on the three existing leaves and
// the four new Face/Eyes/Lips/Skin docs being created — BUT unlike the
// earlier Clothes-division restructure (where the thing being re-parented
// was a *department*, one hop above every leaf, so its own `_id` — the
// value every product's denormalized `topCategory` actually stores — never
// changed), this migration re-parents the *leaves themselves*
// (cosmetics-lipstick etc.), which are exactly what `topCategory` is
// computed from (`category.parent`, see models/productModel.js's
// pre-validate hook). Re-parenting a leaf changes what a NEW save would
// compute, but every EXISTING product keeps its stale, pre-migration
// `topCategory` value until explicitly updated — confirmed as a real bug
// during this script's own test development (a real seeded Lipstick
// product's topCategory stayed pointed at Cosmetics after an earlier,
// unfixed version of this script ran). This version closes that gap: for
// every re-parented leaf, every existing product whose `category` equals
// that leaf also gets its `topCategory` updated to the new tier id, in the
// same transaction as the category re-parenting itself.
//
// Modes:
//   node scripts/migrateCosmeticsFaceEyesLipsSkin.mjs            (dry-run — reports the plan, writes nothing)
//   node scripts/migrateCosmeticsFaceEyesLipsSkin.mjs --apply    (executes the plan inside one transaction)
//
// Safety:
//   - Hard-refuses to run unless NODE_ENV=test AND the connected database's
//     name matches the database segment of MONGO_URI_TEST exactly (a
//     self-consistency check — proves Mongoose actually connected to the
//     database the test URI names, not some other default). This script
//     is NEVER invoked against Preview or Production in this pass; the
//     guard makes that a hard failure, not a policy note.
//   - Connects with `autoIndex: false` (same reasoning as
//     scripts/auditIndexes.mjs: a diagnostic/migration connection must
//     never have side effects of its own beyond what it explicitly writes).
//   - Dry-run (default) performs reads only — zero writes, verified by the
//     test suite.
//   - `--apply` wraps every write in a single Mongo session + withTransaction:
//     either the whole plan commits, or (on any error) nothing does.
//   - Idempotent: running `--apply` twice in a row is a safe no-op the
//     second time (upserts by slug, re-parenting only sets fields already
//     at their target value).
//   - Never logs the connection string, only a redacted host/database
//     name; thrown driver errors are passed through the same redaction.

import mongoose from "mongoose";

import Category from "../models/categoryModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";
import Product from "../models/productModel.js";

function redact(value) {
  return String(value).replace(/:\/\/[^/@\s]*@/g, "://<redacted>@");
}

// Only ever resolves MONGO_URI_TEST — this script has no production/
// preview code path at all, by design, not just by policy.
function resolveTestUri() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("This script only runs with NODE_ENV=test — it has no Preview/Production code path.");
  }
  const uri = process.env.MONGO_URI_TEST;
  if (!uri) throw new Error("MONGO_URI_TEST is not set.");
  return uri;
}

// The database name segment of a mongodb:// URI, parsed without ever
// logging the full (credentialed) string.
function dbNameFromUri(uri) {
  try {
    const afterSlashes = uri.split("://")[1] || "";
    const afterHost = afterSlashes.split("/")[1] || "";
    return afterHost.split("?")[0];
  } catch {
    return null;
  }
}

const TIER_SLUGS = {
  face: "cosmetics-face",
  eyes: "cosmetics-eyes",
  lips: "cosmetics-lips",
  skin: "cosmetics-skin",
};

// Which existing Cosmetics leaf moves under which new tier.
const REPARENT_MAP = {
  "cosmetics-lipstick": "lips",
  "cosmetics-foundation": "face",
  "cosmetics-facewash": "skin",
};

const FINISH_ATTRIBUTE_KEY = "finish";

// Read-only: computes exactly what would change, with no side effects.
// Exported so tests can assert on the plan itself (dry-run reporting)
// independently of whether it's ever applied.
export async function buildMigrationPlan() {
  const cosmetics = await Category.findOne({ slug: "cosmetics", parent: null }).lean();
  if (!cosmetics) {
    throw new Error('Cosmetics department not found (Category slug "cosmetics", parent: null) — nothing to migrate onto.');
  }

  const existingTiers = await Category.find({ slug: { $in: Object.values(TIER_SLUGS) }, parent: cosmetics._id }).lean();
  const existingTierBySlug = new Map(existingTiers.map((c) => [c.slug, c]));

  const tiersToCreate = Object.entries(TIER_SLUGS)
    .filter(([, slug]) => !existingTierBySlug.has(slug))
    .map(([key, slug]) => ({ key, slug, name: key.charAt(0).toUpperCase() + key.slice(1) }));

  const leafSlugs = Object.keys(REPARENT_MAP);
  const leaves = await Category.find({ slug: { $in: leafSlugs } }).lean();
  const leafBySlug = new Map(leaves.map((c) => [c.slug, c]));

  const reparents = [];
  for (const [leafSlug, tierKey] of Object.entries(REPARENT_MAP)) {
    const leaf = leafBySlug.get(leafSlug);
    if (!leaf) continue; // reported separately below as missing, not silently skipped
    const tierId = existingTierBySlug.get(TIER_SLUGS[tierKey])?._id ?? null; // null = "will be the newly created tier"
    const alreadyCorrect = tierId && String(leaf.parent) === String(tierId);
    if (!alreadyCorrect) {
      // Every existing product whose `category` is this leaf also needs
      // its denormalized `topCategory` fixed to the new tier id (see the
      // file-header comment — re-parenting the leaf itself, unlike the
      // earlier Clothes-division department re-parent, directly changes
      // what topCategory should be for products that already exist).
      const affectedProductCount = await Product.countDocuments({ category: leaf._id });
      reparents.push({ leafSlug, leafId: leaf._id, tierKey, affectedProductCount });
    }
  }

  const missingLeaves = leafSlugs.filter((slug) => !leafBySlug.has(slug));

  const existingFinishDef = await AttributeDefinition.findOne({ key: FINISH_ATTRIBUTE_KEY }).lean();

  return {
    cosmeticsId: cosmetics._id,
    tiersToCreate,
    existingTierBySlug,
    reparents,
    missingLeaves,
    finishAttributeExists: !!existingFinishDef,
  };
}

// Applies a plan (from buildMigrationPlan) inside the given transaction
// session. Idempotent: re-running against an already-migrated state
// produces an empty plan (buildMigrationPlan returns nothing left to do),
// so calling applyPlan a second time is a genuine no-op, not just
// harmless — nothing is written.
export async function applyPlan(plan, session) {
  const tierIdByKey = new Map(
    [...plan.existingTierBySlug.entries()].map(([slug, doc]) => [
      Object.entries(TIER_SLUGS).find(([, s]) => s === slug)[0],
      doc._id,
    ]),
  );

  for (const { key, slug, name } of plan.tiersToCreate) {
    // findOneAndUpdate (a query op), not Category.create/doc.save — the
    // schema's own pre("validate") document-middleware hook treats every
    // field on a brand-new document as "modified" and would silently
    // overwrite this explicit, stable slug with an auto-generated one
    // (confirmed: Category.create() here produced e.g. "facex-a1b2c3"
    // instead of "cosmetics-face", breaking idempotency since the next
    // run's slug-based lookup would never find it again). findOneAndUpdate
    // never runs document middleware, so the explicit slug sticks — same
    // upsert-by-slug pattern scripts/seedCatalog.mjs already establishes.
    const tier = await Category.findOneAndUpdate(
      { slug },
      { $set: { name, parent: plan.cosmeticsId, sortOrder: Object.keys(TIER_SLUGS).indexOf(key) } },
      { upsert: true, returnDocument: "after", session, setDefaultsOnInsert: true },
    );
    tierIdByKey.set(key, tier._id);
  }

  for (const { leafId, tierKey } of plan.reparents) {
    const tierId = tierIdByKey.get(tierKey);
    if (!tierId) throw new Error(`Internal error: no tier id resolved for "${tierKey}"`);
    await Category.updateOne({ _id: leafId }, { $set: { parent: tierId } }, { session });
    // Fix every existing product's denormalized topCategory in the SAME
    // transaction as the category re-parent — see the file-header comment.
    // No product `_id` changes, only this one already-denormalized field,
    // kept in sync with what a fresh save would compute from the leaf's
    // new parent.
    await Product.updateMany({ category: leafId }, { $set: { topCategory: tierId } }, { session });
  }

  if (!plan.finishAttributeExists) {
    const finishScopeIds = ["face", "eyes", "lips"].map((k) => tierIdByKey.get(k)).filter(Boolean);
    await AttributeDefinition.create(
      [
        {
          key: FINISH_ATTRIBUTE_KEY,
          label: "Finish",
          type: "select",
          derivedFromVariant: false,
          filterable: true,
          appliesToCategories: finishScopeIds,
          options: [
            { value: "matte", label: "Matte" },
            { value: "glossy", label: "Glossy" },
            { value: "satin", label: "Satin" },
          ],
        },
      ],
      { session },
    );
  }
}

function printPlan(plan) {
  console.log(`Cosmetics department: ${plan.cosmeticsId}`);
  if (plan.missingLeaves.length) {
    console.log(`WARNING: expected leaf categories not found (skipped): ${plan.missingLeaves.join(", ")}`);
  }
  if (!plan.tiersToCreate.length && !plan.reparents.length && plan.finishAttributeExists) {
    console.log("Nothing to do — already fully migrated.");
    return;
  }
  if (plan.tiersToCreate.length) {
    console.log(`Would create ${plan.tiersToCreate.length} new tier categor${plan.tiersToCreate.length === 1 ? "y" : "ies"}: ${plan.tiersToCreate.map((t) => t.name).join(", ")}`);
  } else {
    console.log("Tier categories: already present.");
  }
  if (plan.reparents.length) {
    const totalProducts = plan.reparents.reduce((sum, r) => sum + r.affectedProductCount, 0);
    console.log(
      `Would re-parent ${plan.reparents.length} leaf categor${plan.reparents.length === 1 ? "y" : "ies"} (and fix topCategory on ${totalProducts} existing product${totalProducts === 1 ? "" : "s"}): ${plan.reparents.map((r) => `${r.leafSlug} -> ${r.tierKey} (${r.affectedProductCount} product${r.affectedProductCount === 1 ? "" : "s"})`).join(", ")}`,
    );
  } else {
    console.log("Leaf re-parenting: already correct.");
  }
  console.log(plan.finishAttributeExists ? '"finish" attribute: already present.' : 'Would create the "finish" AttributeDefinition (matte/glossy/satin).');
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = resolveTestUri();
  const expectedDbName = dbNameFromUri(uri);
  if (!expectedDbName) throw new Error("Could not parse a database name out of MONGO_URI_TEST.");

  const conn = await mongoose.connect(uri, { autoIndex: false });
  const actualDbName = conn.connection?.db?.databaseName;
  if (actualDbName !== expectedDbName) {
    throw new Error(`Refusing to proceed: connected to database "${actualDbName}", expected "${expectedDbName}" (from MONGO_URI_TEST).`);
  }
  console.log(`Connected to test database "${actualDbName}" on host "${redact(conn.connection.host)}".`);

  try {
    const plan = await buildMigrationPlan();
    printPlan(plan);

    if (!apply) {
      console.log("\nDry run only — no writes made. Re-run with --apply to perform the migration.");
      return;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await applyPlan(plan, session);
      });
      console.log("Migration applied successfully (transaction committed).");
    } finally {
      await session.endSession();
    }
  } finally {
    await mongoose.disconnect();
    console.log("Connection closed.");
  }
}

// Only auto-run when executed directly (not when imported by the test
// suite, which calls buildMigrationPlan()/applyPlan() itself).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Cosmetics tier migration failed:", redact(err?.message || err));
    process.exit(1);
  });
}
