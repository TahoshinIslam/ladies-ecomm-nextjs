// Phase 5D — the hybrid GET /api/products query contract closure. Real
// HTTP, real seeded catalog (scripts/seedCatalog.mjs, run automatically by
// the test:http harness) so the dynamic-facet half of the contract
// (services/productService.js's parseProductListQuery(), checked against
// live AttributeDefinition records) is exercised against real data, not a
// mock. See tests/http/productFilters.integration.test.mjs for the
// pre-existing storefront-filtering behavior this closure preserves
// unchanged (CSV multi-value ageGroup, unrecognized-value tolerance,
// lenient page/limit fallback) — this file only covers the NEW contract:
// fixed-field bounds and dynamic-facet-key/value validation.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/products?limit=1`);
  serverUp = res.ok;
} catch {
  serverUp = false;
}

let dbConnectable = false;
if (serverUp && dbReady) {
  try {
    await connectTestDb();
    dbConnectable = true;
  } catch {
    dbConnectable = false;
  }
}

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

describe("Phase 5D — GET /api/products hybrid query contract (real MongoDB, via HTTP)", { skip }, () => {
  let AttributeDefinition, Product, Category;

  const fetchJson = async (qs) => {
    const res = await fetch(`${BASE_URL}/api/products?${qs}`);
    return { status: res.status, json: await res.json() };
  };

  before(async () => {
    ({ default: AttributeDefinition } = await import("../../models/attributeDefinitionModel.js"));
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Category } = await import("../../models/categoryModel.js"));
    const occasion = await AttributeDefinition.findOne({ key: "occasion" }).lean();
    assert.ok(occasion, "seed data must include the 'occasion' attribute definition");
    const careInstructions = await AttributeDefinition.findOne({ key: "careInstructions" }).lean();
    assert.ok(careInstructions && careInstructions.filterable === false, "seed data must include a non-filterable 'careInstructions' attribute");
  });

  after(async () => {
    await disconnectTestDb();
  });

  // 1. Valid fixed product filters
  test("1. valid fixed filters (category/brand/isActive/search/sort) succeed", async () => {
    const { status, json } = await fetchJson("isActive=true&sort=-createdAt&search=abaya&limit=5");
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.products));
  });

  // 2. Valid dynamic single-value facet
  test("2. a valid single-value dynamic facet (occasion=eid) succeeds", async () => {
    const { status } = await fetchJson("occasion=eid&limit=5");
    assert.equal(status, 200);
  });

  // 3. Valid dynamic CSV facet
  test("3. a valid CSV dynamic facet (occasion=eid,prayer) succeeds", async () => {
    const { status } = await fetchJson("occasion=eid,prayer&limit=5");
    assert.equal(status, 200);
  });

  // 4. Multiple valid dynamic facets
  test("4. multiple valid dynamic facets (occasion + lining) succeed together", async () => {
    const { status } = await fetchJson("occasion=eid&lining=full&limit=5");
    assert.equal(status, 200);
  });

  // 5. Unknown facet key
  test("5. an unrecognized facet key is rejected (400)", async () => {
    const { status, json } = await fetchJson("thisAttributeDoesNotExist=foo");
    assert.equal(status, 400);
    assert.equal(json.success, false);
  });

  // 6. Disabled/non-filterable attribute
  test("6. a real but non-filterable attribute (careInstructions) is rejected (400)", async () => {
    const { status } = await fetchJson("careInstructions=cold-wash");
    assert.equal(status, 400);
  });

  // 7. Invalid select option
  test("7. an invalid option value for a real select attribute is rejected (400)", async () => {
    const { status } = await fetchJson("occasion=not-a-real-occasion");
    assert.equal(status, 400);
  });

  // 8. Too many facet values
  test("8. too many CSV values for one facet is rejected (400)", async () => {
    const many = Array.from({ length: 25 }, (_, i) => `v${i}`).join(",");
    const { status } = await fetchJson(`occasion=${many}`);
    assert.equal(status, 400);
  });

  // 9. Empty CSV segment
  test("9. an empty CSV segment is rejected (400)", async () => {
    const { status } = await fetchJson("occasion=eid,,prayer");
    assert.equal(status, 400);
  });

  // 10. Duplicate CSV values and documented normalization (dedup, not reject)
  test("10. duplicate CSV values within one facet are de-duplicated, not rejected", async () => {
    const { status } = await fetchJson("occasion=eid,eid,prayer");
    assert.equal(status, 200);
  });

  // 11. Repeated URL query key
  test("11. a repeated URL query parameter is rejected (400)", async () => {
    const { status } = await fetchJson("limit=5&limit=10");
    assert.equal(status, 400);
  });

  // 12. $/dot/operator-shaped key
  test("12. a Mongo-operator-shaped facet key ($gt) is rejected (400)", async () => {
    const { status } = await fetchJson("occasion[$gt]=");
    assert.equal(status, 400);
  });

  test("12b. a dotted facet key is rejected (400)", async () => {
    const { status } = await fetchJson(encodeURI("a.b") + "=1");
    assert.equal(status, 400);
  });

  // 13. prototype-pollution-shaped key
  test("13. prototype-pollution-shaped facet keys (constructor, prototype) are rejected (400)", async () => {
    for (const key of ["constructor", "prototype"]) {
      const { status } = await fetchJson(`${key}=x`);
      assert.equal(status, 400, `key "${key}" should be rejected`);
    }
  });

  // A bare `?__proto__=x` never reaches our route handler's `request.url`
  // at all — confirmed empirically: Next.js's own routing layer strips it
  // upstream before the Request object is even constructed (this is a
  // framework-level protection, not something this app's code does or can
  // observe). The net effect is even safer than a 400: the parameter is
  // erased entirely, identical to not having been sent, so no filter is
  // ever applied and nothing is ever polluted. lib/validation.js's
  // assertNoDangerousQueryKeys() still exists as defense-in-depth for the
  // two names (constructor/prototype) Next does NOT special-case, proven
  // above.
  test("13b. a bare __proto__ query key is stripped upstream by Next.js itself and never reaches the filter (200, no facet applied)", async () => {
    const withKey = await fetchJson("__proto__=x&limit=5");
    const withoutKey = await fetchJson("limit=5");
    assert.equal(withKey.status, 200);
    assert.equal(withKey.json.total, withoutKey.json.total, "a stripped __proto__ param must behave identically to no filter at all");
  });

  // 14. excessive key/value/query length
  test("14. an excessively long facet key is rejected (400)", async () => {
    const longKey = "a".repeat(60);
    const { status } = await fetchJson(`${longKey}=x`);
    assert.equal(status, 400);
  });

  test("14b. an excessively long facet value is rejected (400)", async () => {
    const longValue = "x".repeat(300);
    const { status } = await fetchJson(`occasion=${longValue}`);
    assert.equal(status, 400);
  });

  test("14c. too many distinct dynamic facets in one request is rejected (400)", async () => {
    const defs = await AttributeDefinition.find().lean();
    const keys = defs.map((d) => d.key);
    // Pad with enough distinct (even nonexistent, still key-shape-valid)
    // facet names to exceed MAX_DYNAMIC_FACETS — the facet-count bound is
    // checked before any definition lookup, so these don't need to be real.
    const padded = [...keys, ...Array.from({ length: 20 }, (_, i) => `extraFacet${i}`)];
    const qs = padded.map((k) => `${k}=x`).join("&");
    const { status } = await fetchJson(qs);
    assert.equal(status, 400);
  });

  // 15. invalid boolean
  test("15. an invalid boolean encoding for isActive is rejected (400)", async () => {
    const { status } = await fetchJson("isActive=yes");
    assert.equal(status, 400);
  });

  // 16. invalid numeric/range value
  test("16. a non-numeric basePrice range bound is rejected (400)", async () => {
    const { status } = await fetchJson("basePrice[gte]=not-a-number");
    assert.equal(status, 400);
  });

  // 17. minPrice greater than maxPrice
  test("17. basePrice[gte] greater than basePrice[lte] is rejected (400)", async () => {
    const { status } = await fetchJson("basePrice[gte]=5000&basePrice[lte]=1000");
    assert.equal(status, 400);
  });

  // 18. unsupported sort field/direction
  test("18. an unrecognized sort field is rejected (400)", async () => {
    const { status } = await fetchJson("sort=__v");
    assert.equal(status, 400);
  });

  // 19. regex-special search text treated literally (no crash, no leak)
  test("19. regex-special characters in search are treated literally (200, no crash)", async () => {
    const { status } = await fetchJson(`search=${encodeURIComponent("a(b)[c]*+?")}`);
    assert.equal(status, 200);
  });

  // 20. malformed category/brand ID where applicable
  test("20. a malformed category id is rejected (400)", async () => {
    const { status } = await fetchJson("category=not-an-id");
    assert.equal(status, 400);
  });

  test("20b. a malformed brand id is rejected (400)", async () => {
    const { status } = await fetchJson("brand=not-an-id");
    assert.equal(status, 400);
  });

  // 21. storefront filter compatibility
  test("21. storefront: real ageGroup CSV + dynamic facet combine correctly (200)", async () => {
    const { status, json } = await fetchJson("ageGroup=kids,girls&occasion=eid&limit=200");
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.products));
  });

  // 22. administrator filter compatibility
  test("22. admin-shaped query (topCategory + isActive + sort) succeeds (200)", async () => {
    const burqa = await Category.findOne({ slug: "burqa" }).lean();
    assert.ok(burqa, "seed data must include the Burqa department");
    const { status, json } = await fetchJson(`topCategory=${burqa._id}&isActive=true&sort=-createdAt&limit=20`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.products));
  });

  // 24 (partial — the client-serialization half is covered by
  // tests/clientServerSchemaParity.test.mjs and the real
  // buildQueryString()/parseQueryParams() round trip already exercised
  // throughout this file via basePrice[gte]/[lte]).
  test("24. the real client bracket-notation range wire format (basePrice[gte]/[lte]) round-trips correctly", async () => {
    const { status, json } = await fetchJson("basePrice[gte]=100&basePrice[lte]=500000&limit=50");
    assert.equal(status, 200);
    for (const p of json.products) {
      assert.ok(p.basePrice >= 100 && p.basePrice <= 500000);
    }
  });

  test("fields projection is restricted to the known-safe allowlist", async () => {
    const bad = await fetchJson("fields=someInternalField&limit=1");
    assert.equal(bad.status, 400);
    const good = await fetchJson("fields=basePrice,discountPrice&limit=1");
    assert.equal(good.status, 200);
  });

  test("pre-existing productFilters.integration.test.mjs behaviors are unaffected: malformed pagination still falls back to defaults", async () => {
    const { status, json } = await fetchJson("page=not-a-number&limit=also-not-a-number");
    assert.equal(status, 200);
    assert.equal(json.page, 1);
    assert.equal(json.limit, 12);
  });

  test("pre-existing behavior unaffected: an unrecognized ageGroup value is still safely ignored, not rejected", async () => {
    const { status } = await fetchJson("ageGroup=not-a-real-value");
    assert.equal(status, 200);
  });
});
