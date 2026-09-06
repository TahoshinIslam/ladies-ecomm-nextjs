// Phase 8 — pure-function tests for the shop/home product-list cache-
// eligibility policy (lib/shopCacheEligibility.js). No database needed:
// this module only canonicalizes an already-Phase-5-validated query
// object into a cache key or decides it's ineligible.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getShopCacheKey } from "../lib/shopCacheEligibility.js";

describe("Phase 8 — shop cache eligibility: canonical equivalence", () => {
  test("two equivalent queries with keys in a different insertion order produce the same key", () => {
    const a = getShopCacheKey({ category: "abc123", sort: "-createdAt", limit: "12" });
    const b = getShopCacheKey({ limit: "12", sort: "-createdAt", category: "abc123" });
    assert.equal(a, b);
    assert.ok(a);
  });

  test("a CSV set field's value order doesn't create a separate entry", () => {
    const a = getShopCacheKey({ ageGroup: "kids,girls" });
    const b = getShopCacheKey({ ageGroup: "girls,kids" });
    assert.equal(a, b);
  });

  test("basePrice's own operator-key order doesn't create a separate entry", () => {
    const a = getShopCacheKey({ basePrice: { gte: "100", lte: "500" } });
    const b = getShopCacheKey({ basePrice: { lte: "500", gte: "100" } });
    assert.equal(a, b);
  });

  test("a genuinely different filter value produces a different key", () => {
    const a = getShopCacheKey({ category: "abc123" });
    const b = getShopCacheKey({ category: "xyz789" });
    assert.notEqual(a, b);
  });

  test("the default (empty) query still produces a stable, real key", () => {
    const a = getShopCacheKey({});
    const b = getShopCacheKey({});
    assert.equal(a, b);
    assert.equal(typeof a, "string");
  });
});

describe("Phase 8 — shop cache eligibility: ineligible queries", () => {
  test("free-text search makes the whole query ineligible", () => {
    assert.equal(getShopCacheKey({ search: "abaya" }), null);
    assert.equal(getShopCacheKey({ search: "abaya", category: "abc123" }), null);
  });

  test("any dynamic attribute facet key makes the whole query ineligible", () => {
    assert.equal(getShopCacheKey({ fabric: "nida" }), null);
    assert.equal(getShopCacheKey({ coverageLevel: "full", category: "abc123" }), null);
  });

  test("an admin request is never cached through this policy", () => {
    assert.equal(getShopCacheKey({ category: "abc123" }, { isAdmin: true }), null);
  });

  test("a canonical key that would exceed the safe length bound is rejected", () => {
    const huge = { category: "x".repeat(400) };
    assert.equal(getShopCacheKey(huge), null);
  });

  test("an ineligible query never throws — it always returns null so the caller can fall back to an uncached read", () => {
    assert.doesNotThrow(() => getShopCacheKey({ search: "x", weirdUnknownKey: "y" }));
  });
});
