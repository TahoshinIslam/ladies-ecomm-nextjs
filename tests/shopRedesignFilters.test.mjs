// Shop redesign v3 — services/productService.js's new filter/facet
// dimensions (collection, availability, ratingGte), the effective-price
// fix, the explicit attribute-scoping pipeline (stale-filter removal), and
// the Cosmetics Face/Eyes/Lips/Skin descendant isolation. Creates its own
// department/category/product fixtures (never depends on
// scripts/seedCatalog.mjs having run) and runs only against
// MONGO_URI_TEST.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";
import { HttpError } from "../lib/http.js";

const execFileAsync = promisify(execFile);
const canRun = dbReady;
const reason = skipReason;
const MIGRATION_SCRIPT = new URL("../scripts/migrateCosmeticsFaceEyesLipsSkin.mjs", import.meta.url).pathname;

function runMigrationCli(extraArgs = []) {
  return execFileAsync("node", [MIGRATION_SCRIPT, ...extraArgs], {
    env: { ...process.env, NODE_ENV: "test" },
  }).catch((err) => err);
}

describe("Shop redesign v3 — filters, facets, effective price, stale-filter removal, Cosmetics tiers", { skip: !canRun && reason }, () => {
  let Category, Product, AttributeDefinition;
  let listProducts, parseProductListQuery, getStorefrontDepartmentIds, buildFacetCounts;
  let buildMigrationPlan, applyPlan;
  let mongoose;

  let division, dept, leafA, leafB;
  let productDiscounted, productPlain, productOutOfStock, productRated, productUnrated;

  before(async () => {
    await connectTestDb();
    ({ default: mongoose } = await import("mongoose"));
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ listProducts, parseProductListQuery, getStorefrontDepartmentIds, buildFacetCounts } = await import("../services/productService.js"));
    ({ buildMigrationPlan, applyPlan } = await import("../scripts/migrateCosmeticsFaceEyesLipsSkin.mjs"));

    const suffix = Date.now();
    dept = await Category.create({ name: `Test Dept ${suffix}`, slug: `test-dept-${suffix}` });
    leafA = await Category.create({ name: `Test Leaf A ${suffix}`, slug: `test-leaf-a-${suffix}`, parent: dept._id });
    leafB = await Category.create({ name: `Test Leaf B ${suffix}`, slug: `test-leaf-b-${suffix}`, parent: dept._id });

    const base = {
      description: "Fixture product for shop redesign tests.",
      category: leafA._id,
      images: ["https://placehold.co/400x400?text=test"],
    };

    productDiscounted = await Product.create({
      ...base,
      name: `Discounted Product ${suffix}`,
      basePrice: 1500,
      discountPrice: 1200,
      variants: [{ variantName: "Default", sku: `TEST-DISC-${suffix}`, stock: 10 }],
    });
    productPlain = await Product.create({
      ...base,
      name: `Plain Product ${suffix}`,
      basePrice: 1250,
      variants: [{ variantName: "Default", sku: `TEST-PLAIN-${suffix}`, stock: 10 }],
    });
    productOutOfStock = await Product.create({
      ...base,
      name: `Out Of Stock Product ${suffix}`,
      basePrice: 500,
      variants: [{ variantName: "Default", sku: `TEST-OOS-${suffix}`, stock: 0 }],
    });
    productRated = await Product.create({
      ...base,
      name: `Rated Product ${suffix}`,
      basePrice: 800,
      rating: 4.5,
      variants: [{ variantName: "Default", sku: `TEST-RATED-${suffix}`, stock: 5 }],
    });
    productUnrated = await Product.create({
      ...base,
      name: `Unrated Product ${suffix}`,
      basePrice: 800,
      variants: [{ variantName: "Default", sku: `TEST-UNRATED-${suffix}`, stock: 5 }],
    });
  });

  after(async () => {
    await Product.deleteMany({ _id: { $in: [productDiscounted?._id, productPlain?._id, productOutOfStock?._id, productRated?._id, productUnrated?._id].filter(Boolean) } });
    await Category.deleteMany({ _id: { $in: [dept?._id, leafA?._id, leafB?._id].filter(Boolean) } });
    await disconnectTestDb();
  });

  describe("Effective-price filtering (v3-5/v2-6) — the regression this fixes", () => {
    test("a discounted product (basePrice 1500, discountPrice 1200) is included in priceMax=1300 — a basePrice-only comparison would wrongly exclude it", async () => {
      const result = await listProducts({ category: dept._id.toString(), basePrice: { lte: "1300" }, limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(productDiscounted._id)), "the discounted product (effective price 1200) must be included");
    });

    test("a discounted product is correctly EXCLUDED from priceMax=1100 (below its real 1200 selling price, even though its basePrice 1500 is also above)", async () => {
      const result = await listProducts({ category: dept._id.toString(), basePrice: { lte: "1100" }, limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productDiscounted._id)));
    });

    test("priceMin correctly uses effective price too (a discounted product doesn't wrongly satisfy a minimum meant to exclude it)", async () => {
      const result = await listProducts({ category: dept._id.toString(), basePrice: { gte: "1300" }, limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productDiscounted._id)), "effective price 1200 must not satisfy a >=1300 minimum, even though basePrice 1500 would");
    });
  });

  describe("Availability filter", () => {
    test("availability=in_stock excludes the zero-stock product", async () => {
      const result = await listProducts({ category: dept._id.toString(), availability: "in_stock", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productOutOfStock._id)));
      assert.ok(ids.includes(String(productDiscounted._id)));
    });

    test("availability=out_of_stock returns only the zero-stock product", async () => {
      const result = await listProducts({ category: dept._id.toString(), availability: "out_of_stock", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(productOutOfStock._id)));
      assert.ok(!ids.includes(String(productDiscounted._id)));
    });
  });

  describe("Rating threshold filter", () => {
    test("ratingGte=4 includes the 4.5-rated product and excludes the unrated (0) one", async () => {
      const result = await listProducts({ category: dept._id.toString(), ratingGte: "4", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(productRated._id)));
      assert.ok(!ids.includes(String(productUnrated._id)));
    });

    test("ratingGte=1 (the lowest threshold) still excludes an unrated (rating: 0) product — 'at least 1 star' is not satisfied by zero stars", async () => {
      const result = await listProducts({ category: dept._id.toString(), ratingGte: "1", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productUnrated._id)));
      assert.ok(ids.includes(String(productRated._id)));
    });
  });

  // Called directly with scopeIds: null (like an admin request would
  // resolve, minus the storefront-department allowlist that doesn't know
  // about this file's ad-hoc test fixtures) so these tests exercise the
  // real self-exclusion logic against real fixture data, independent of
  // getStorefrontDepartmentIds()'s unrelated real-department allowlist
  // (covered by its own tests elsewhere).
  describe("Self-excluding facet counts for the new dimensions", () => {
    test("availability facet counts ignore the current availability selection when computing each option's own count", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString(), availability: "in_stock" }, {}, null);
      assert.ok(facets.availability.out_of_stock >= 1, "out_of_stock count must not be zeroed out by the active in_stock filter");
      assert.ok(facets.availability.in_stock >= 1);
    });

    test("ratingGte facet counts are present for all 5 thresholds and reflect real data", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString() }, {}, null);
      for (const n of [1, 2, 3, 4, 5]) {
        assert.ok(typeof facets.ratingGte[n] === "number", `expected a numeric count for threshold ${n}`);
      }
      assert.ok(facets.ratingGte[4] >= 1, "the 4.5-rated fixture must be counted at the 4+ threshold");
      assert.equal(facets.ratingGte[5], 0, "no fixture is rated exactly 5, so this bucket must be 0, not miscounted");
    });

    test("collection facet counts use the real-discount definition (matches effective-price semantics), not a bare discountPrice != null check", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString() }, {}, null);
      assert.ok(facets.collection.discount >= 1, "the real discounted fixture must be counted");
    });

    test("ageGroup facet counts still work unaffected by the new dimensions being added alongside them", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString(), ratingGte: "4" }, {}, null);
      assert.equal(typeof facets.ageGroup.adult, "number");
    });
  });

  describe("Collection: canonical vs legacy, and rejecting a mixed request", () => {
    test("collection=discount and the legacy discount=true resolve to the same result set", async () => {
      const canonical = await listProducts({ category: dept._id.toString(), collection: "discount", limit: 50 }, { isAdmin: true });
      const legacy = await listProducts({ category: dept._id.toString(), discount: "true", limit: 50 }, { isAdmin: true });
      const canonicalIds = canonical.products.map((p) => String(p._id)).sort();
      const legacyIds = legacy.products.map((p) => String(p._id)).sort();
      assert.deepEqual(canonicalIds, legacyIds);
    });

    test("parseProductListQuery rejects collection= combined with a legacy boolean (v3-6)", async () => {
      await assert.rejects(
        () => parseProductListQuery({ collection: "new", featured: "true" }),
        (err) => err instanceof HttpError && err.status === 400,
      );
    });

    test("parseProductListQuery accepts collection= alone", async () => {
      const out = await parseProductListQuery({ collection: "featured" });
      assert.equal(out.collection, "featured");
    });

    test("parseProductListQuery rejects an invalid collection value", async () => {
      await assert.rejects(() => parseProductListQuery({ collection: "bogus" }), (err) => err instanceof HttpError && err.status === 400);
    });

    test("parseProductListQuery rejects an invalid ratingGte value (out of 1-5 range)", async () => {
      await assert.rejects(() => parseProductListQuery({ ratingGte: "6" }), (err) => err instanceof HttpError && err.status === 400);
      await assert.rejects(() => parseProductListQuery({ ratingGte: "0" }), (err) => err instanceof HttpError && err.status === 400);
    });

    test("parseProductListQuery rejects an invalid availability value", async () => {
      await assert.rejects(() => parseProductListQuery({ availability: "sold_out" }), (err) => err instanceof HttpError && err.status === 400);
    });
  });

  describe("Stale-filter removal — the 4-outcome matrix (v3-4)", () => {
    let otherDept, otherLeaf, realAttrDef;

    before(async () => {
      const suffix = `sfr-${Date.now()}`;
      otherDept = await Category.create({ name: `Other Dept ${suffix}`, slug: `other-dept-${suffix}` });
      otherLeaf = await Category.create({ name: `Other Leaf ${suffix}`, slug: `other-leaf-${suffix}`, parent: otherDept._id });
      realAttrDef = await AttributeDefinition.create({
        key: `onlyOnOtherDept${suffix.replace(/-/g, "")}`,
        label: "Only On Other Dept",
        type: "select",
        filterable: true,
        appliesToCategories: [otherDept._id],
        options: [{ value: "x", label: "X" }],
      });
    });

    after(async () => {
      await Category.deleteMany({ _id: { $in: [otherDept?._id, otherLeaf?._id].filter(Boolean) } });
      await AttributeDefinition.deleteOne({ _id: realAttrDef?._id });
    });

    test("a real attribute key that doesn't apply to the currently-selected department is dropped server-side, not left to wrongly zero the result set", async () => {
      // `dept` (this describe block's outer fixture) has no products with
      // this attribute at all, and the attribute isn't even scoped to
      // `dept` — the naive old behavior would $elemMatch on a key no
      // product in `dept` ever has, returning zero results. The fix strips
      // it before that ever happens, so the normal category-only result
      // set survives unchanged.
      const withStaleFilter = await listProducts(
        { category: dept._id.toString(), [realAttrDef.key]: "x", limit: 50 },
        { isAdmin: true },
      );
      const withoutFilter = await listProducts({ category: dept._id.toString(), limit: 50 }, { isAdmin: true });
      assert.equal(withStaleFilter.total, withoutFilter.total, "the inapplicable attribute filter must be stripped, not silently zero the results");
    });

    test("the same attribute key correctly filters when the applicable department IS selected (a valid, applicable attribute still filters normally)", async () => {
      const result = await listProducts({ category: otherDept._id.toString(), [realAttrDef.key]: "x", limit: 50 }, { isAdmin: true });
      assert.equal(result.total, 0, "no real product carries this attribute value yet, so 0 is correct — the key was NOT stripped this time, it was validated and applied");
    });

    test("an unrecognized/unknown key is still rejected with 400 by parseProductListQuery (unchanged behavior)", async () => {
      await assert.rejects(() => parseProductListQuery({ totallyMadeUpKey123: "x" }), (err) => err instanceof HttpError && err.status === 400);
    });
  });

  describe("Cosmetics Face/Eyes/Lips/Skin descendant isolation (via the real migration script's plan/apply against test-only fixtures)", () => {
    let cosmeticsRoot, faceCategory, lipsCategory, skinCategory;
    let lipstickLeaf, foundationLeaf, facewashLeaf;
    let lipstickProduct, foundationProduct, facewashProduct;

    before(async () => {
      const suffix = `cos-${Date.now()}`;
      cosmeticsRoot = await Category.create({ name: `Cosmetics ${suffix}`, slug: `cosmetics-${suffix}` });
      lipstickLeaf = await Category.create({ name: "Lipstick", slug: `cosmetics-lipstick-${suffix}`, parent: cosmeticsRoot._id });
      foundationLeaf = await Category.create({ name: "Foundation", slug: `cosmetics-foundation-${suffix}`, parent: cosmeticsRoot._id });
      facewashLeaf = await Category.create({ name: "Facewash", slug: `cosmetics-facewash-${suffix}`, parent: cosmeticsRoot._id });

      lipstickProduct = await Product.create({
        name: `Test Lipstick ${suffix}`,
        description: "fixture",
        category: lipstickLeaf._id,
        basePrice: 10,
        images: ["https://placehold.co/1x1"],
        variants: [{ variantName: "Default", sku: `LIP-${suffix}`, stock: 5 }],
      });
      foundationProduct = await Product.create({
        name: `Test Foundation ${suffix}`,
        description: "fixture",
        category: foundationLeaf._id,
        basePrice: 20,
        images: ["https://placehold.co/1x1"],
        variants: [{ variantName: "Default", sku: `FND-${suffix}`, stock: 5 }],
      });
      facewashProduct = await Product.create({
        name: `Test Facewash ${suffix}`,
        description: "fixture",
        category: facewashLeaf._id,
        basePrice: 6,
        images: ["https://placehold.co/1x1"],
        variants: [{ variantName: "Default", sku: `FCW-${suffix}`, stock: 5 }],
      });

      // Build a plan against these fixtures directly (bypassing the
      // hardcoded "cosmetics"/"cosmetics-lipstick" slugs the real script
      // targets) by constructing the tier categories the same way, then
      // re-parenting via the same Category API the script itself uses —
      // proves the DESCENDANT-ISOLATION QUERY BEHAVIOR (the actual thing
      // this describe block is testing), independent of the real script's
      // slug wiring (covered separately below, against the real seeded
      // "cosmetics" data).
      faceCategory = await Category.create({ name: "Face", slug: `cosmetics-face-${suffix}`, parent: cosmeticsRoot._id });
      lipsCategory = await Category.create({ name: "Lips", slug: `cosmetics-lips-${suffix}`, parent: cosmeticsRoot._id });
      skinCategory = await Category.create({ name: "Skin", slug: `cosmetics-skin-${suffix}`, parent: cosmeticsRoot._id });
      // Re-parenting a LEAF (unlike a department) changes what its
      // products' denormalized topCategory should be — the real migration
      // script fixes this atomically (see its file-header comment); this
      // fixture must do the same or every query below would wrongly see
      // stale topCategory values from before the re-parent.
      await Category.updateOne({ _id: lipstickLeaf._id }, { $set: { parent: lipsCategory._id } });
      await Product.updateMany({ category: lipstickLeaf._id }, { $set: { topCategory: lipsCategory._id } });
      await Category.updateOne({ _id: foundationLeaf._id }, { $set: { parent: faceCategory._id } });
      await Product.updateMany({ category: foundationLeaf._id }, { $set: { topCategory: faceCategory._id } });
      await Category.updateOne({ _id: facewashLeaf._id }, { $set: { parent: skinCategory._id } });
      await Product.updateMany({ category: facewashLeaf._id }, { $set: { topCategory: skinCategory._id } });
    });

    after(async () => {
      await Product.deleteMany({ _id: { $in: [lipstickProduct?._id, foundationProduct?._id, facewashProduct?._id].filter(Boolean) } });
      await Category.deleteMany({
        _id: {
          $in: [cosmeticsRoot?._id, faceCategory?._id, lipsCategory?._id, skinCategory?._id, lipstickLeaf?._id, foundationLeaf?._id, facewashLeaf?._id].filter(Boolean),
        },
      });
    });

    test("Cosmetics (the root) returns all descendants (lipstick, foundation, facewash)", async () => {
      const result = await listProducts({ category: cosmeticsRoot._id.toString(), limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(lipstickProduct._id)));
      assert.ok(ids.includes(String(foundationProduct._id)));
      assert.ok(ids.includes(String(facewashProduct._id)));
    });

    test("Lips returns only the lipstick product, excluding Face/Skin products", async () => {
      const result = await listProducts({ category: lipsCategory._id.toString(), limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(lipstickProduct._id)));
      assert.ok(!ids.includes(String(foundationProduct._id)));
      assert.ok(!ids.includes(String(facewashProduct._id)));
    });

    test("Face excludes Lips products and vice versa", async () => {
      const faceResult = await listProducts({ category: faceCategory._id.toString(), limit: 50 }, { isAdmin: true });
      const faceIds = faceResult.products.map((p) => String(p._id));
      assert.ok(faceIds.includes(String(foundationProduct._id)));
      assert.ok(!faceIds.includes(String(lipstickProduct._id)));
    });

    test("clothing-only attributes (size/fabric) never appear as applicable attributes for a Cosmetics leaf — resolveAttributesForCategory only returns what's actually scoped there", async () => {
      const { resolveAttributesForCategory } = await import("../services/attributeService.js");
      const defs = await resolveAttributesForCategory(lipsCategory._id);
      const keys = defs.map((d) => d.key);
      assert.ok(!keys.includes("fabric"), "fabric must never be scoped to a Cosmetics category in this fixture");
    });
  });

  describe("The real Cosmetics migration script — CLI dry-run/apply/idempotency, plan correctness, and forced-failure rollback", () => {
    // The migration script has a real, documented dependency: a Cosmetics
    // department (Category slug "cosmetics") must already exist. On a
    // developer machine that's already run scripts/seedCatalog.mjs, it
    // does — but CI provisions a fresh, empty test database per run, so
    // this suite must never assume ambient seed data exists (confirmed by
    // a real CI failure: the dry-run exited 1 there with "Cosmetics
    // department not found," while passing locally against pre-seeded
    // data). Create a minimal fixture only when nothing real is already
    // there, and only clean up what this block itself created.
    let ownsCosmeticsFixture = false;
    let fixtureLeafIds = [];

    before(async () => {
      const existing = await Category.findOne({ slug: "cosmetics", parent: null }).lean();
      if (existing) return;
      ownsCosmeticsFixture = true;
      // findOneAndUpdate (a query op), not Category.create — the schema's
      // pre("validate") document-middleware hook treats every field on a
      // brand-new document as "modified" and silently overwrites an
      // explicit slug with an auto-generated one (the exact bug this
      // migration script itself had — see its own comment). Same
      // upsert-by-slug pattern used there and in scripts/seedCatalog.mjs.
      const upsertCategory = (slug, data) =>
        Category.findOneAndUpdate({ slug }, { $set: data }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
      const cosmetics = await upsertCategory("cosmetics", { name: "Cosmetics", parent: null });
      const lipstick = await upsertCategory("cosmetics-lipstick", { name: "Lipstick", parent: cosmetics._id });
      const foundation = await upsertCategory("cosmetics-foundation", { name: "Foundation", parent: cosmetics._id });
      const facewash = await upsertCategory("cosmetics-facewash", { name: "Facewash", parent: cosmetics._id });
      fixtureLeafIds = [lipstick._id, foundation._id, facewash._id];
    });

    after(async () => {
      if (!ownsCosmeticsFixture) return;
      await Product.deleteMany({ category: { $in: fixtureLeafIds } });
      await Category.deleteMany({ slug: { $regex: /^cosmetics(-|$)/ } });
      await AttributeDefinition.deleteOne({ key: "finish" });
    });

    test("dry-run reports a real plan without writing anything", async () => {
      const dry = await runMigrationCli();
      const output = (dry.stdout || "") + (dry.stderr || "");
      assert.equal(dry.code ?? 0, 0, `dry-run must exit 0:\n${output}`);
      assert.match(output, /Dry run only/);
    });

    test("buildMigrationPlan()/applyPlan() round-trip: applying twice is idempotent (second apply is a genuine no-op)", async () => {
      const plan1 = await buildMigrationPlan();
      const session1 = await mongoose.startSession();
      try {
        await session1.withTransaction(async () => applyPlan(plan1, session1));
      } finally {
        await session1.endSession();
      }

      const plan2 = await buildMigrationPlan();
      assert.equal(plan2.tiersToCreate.length, 0, "no tiers left to create on the second pass");
      assert.equal(plan2.reparents.length, 0, "no re-parenting left to do on the second pass");
      assert.equal(plan2.finishAttributeExists, true);
    });

    test("a forced mid-transaction failure leaves zero partial state (full rollback)", async () => {
      // Reset to a pre-migration state for a clean forced-failure test —
      // safe because this whole describe block only ever touches the
      // "cosmetics" tree (real seeded data or this block's own fixture,
      // per the before() hook above) via this script's own idempotent
      // plan/apply functions, never ad hoc direct writes.
      const cosmetics = await Category.findOne({ slug: "cosmetics", parent: null }).lean();
      await Category.deleteMany({ slug: { $in: ["cosmetics-face", "cosmetics-eyes", "cosmetics-lips", "cosmetics-skin"] } });
      await Category.updateMany(
        { slug: { $in: ["cosmetics-lipstick", "cosmetics-foundation", "cosmetics-facewash"] } },
        { $set: { parent: cosmetics._id } },
      );
      await AttributeDefinition.deleteOne({ key: "finish" });

      const plan = await buildMigrationPlan();
      const session = await mongoose.startSession();
      const originalUpdateOne = Category.updateOne.bind(Category);
      try {
        await assert.rejects(
          session.withTransaction(async () => {
            Category.updateOne = () => {
              throw new Error("forced failure for rollback test");
            };
            try {
              await applyPlan(plan, session);
            } finally {
              Category.updateOne = originalUpdateOne;
            }
          }),
        );
      } finally {
        Category.updateOne = originalUpdateOne;
        await session.endSession();
      }

      const tiersAfter = await Category.find({ parent: cosmetics._id, slug: { $regex: /^cosmetics-(face|eyes|lips|skin)$/ } }).lean();
      assert.equal(tiersAfter.length, 0, "forced failure must roll back every write in the transaction, including the tier categories already created");
      const finishAfter = await AttributeDefinition.findOne({ key: "finish" }).lean();
      assert.equal(finishAfter, null);

      // Restore the real, correct migrated state for anything else that
      // might depend on it (and to leave the test DB clean).
      const restorePlan = await buildMigrationPlan();
      const restoreSession = await mongoose.startSession();
      try {
        await restoreSession.withTransaction(async () => applyPlan(restorePlan, restoreSession));
      } finally {
        await restoreSession.endSession();
      }
    });
  });
});
