// Phase 5 — direct unit tests for the shared validation architecture
// itself (lib/validation.js + schemas/commonSchemas.js), independent of
// any one route. No database needed — these are pure functions.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { queryParamsToObject, assertNoOperatorInjection, isObjectIdFormat, requireObjectIdFormat } from "../lib/validation.js";
import { boundedIntParam, paginationSchema, objectIdSchema } from "../schemas/commonSchemas.js";

describe("lib/validation.js — queryParamsToObject", () => {
  test("a single value stays a scalar string", () => {
    const sp = new URLSearchParams("limit=20");
    assert.deepEqual(queryParamsToObject(sp), { limit: "20" });
  });

  test("a repeated key becomes an array, not silently the last value", () => {
    const sp = new URLSearchParams("limit=10&limit=20");
    assert.deepEqual(queryParamsToObject(sp), { limit: ["10", "20"] });
  });
});

describe("schemas/commonSchemas.js — boundedIntParam (pagination bounds)", () => {
  const schema = boundedIntParam({ min: 1, max: 100, defaultValue: 20 });

  test("missing value uses the default", () => {
    assert.equal(schema.parse(undefined), 20);
  });
  test("a valid value in range parses to a number", () => {
    assert.equal(schema.parse("50"), 50);
  });
  test("the maximum boundary is accepted", () => {
    assert.equal(schema.parse("100"), 100);
  });
  test("above the maximum is rejected", () => {
    assert.throws(() => schema.parse("101"));
  });
  test("zero is rejected (below min:1)", () => {
    assert.throws(() => schema.parse("0"));
  });
  test("negative is rejected", () => {
    assert.throws(() => schema.parse("-1"));
  });
  test("a decimal is rejected", () => {
    assert.throws(() => schema.parse("1.5"));
  });
  test("non-numeric ('abc') is rejected", () => {
    assert.throws(() => schema.parse("abc"));
  });
  test("whitespace-only is rejected", () => {
    assert.throws(() => schema.parse("   "));
  });
  test("an extremely long numeric string (would overflow to Infinity) is rejected", () => {
    assert.throws(() => schema.parse("9".repeat(400)));
  });
  test("a repeated/array value is rejected, not silently resolved to one element", () => {
    assert.throws(() => schema.parse(["10", "20"]));
  });
  test("NaN-shaped input ('NaN' the literal string) is rejected", () => {
    assert.throws(() => schema.parse("NaN"));
  });
  test("Infinity-shaped input (the literal string) is rejected", () => {
    assert.throws(() => schema.parse("Infinity"));
  });
});

describe("schemas/commonSchemas.js — paginationSchema", () => {
  test("applies independent defaults for page and limit", () => {
    const result = paginationSchema().parse({});
    assert.deepEqual(result, { page: 1, limit: 20 });
  });
  test("respects a custom maxLimit", () => {
    const schema = paginationSchema({ maxLimit: 10, defaultLimit: 5 });
    assert.throws(() => schema.parse({ limit: "11" }));
    assert.equal(schema.parse({ limit: "10" }).limit, 10);
  });
});

describe("schemas/commonSchemas.js — objectIdSchema", () => {
  test("a valid 24-char hex string parses", () => {
    assert.equal(objectIdSchema.parse("507f1f77bcf86cd799439011"), "507f1f77bcf86cd799439011");
  });
  test("too short is rejected", () => {
    assert.throws(() => objectIdSchema.parse("507f1f77"));
  });
  test("non-hex characters are rejected", () => {
    assert.throws(() => objectIdSchema.parse("zzzzzzzzzzzzzzzzzzzzzzzz"));
  });
  test("a Mongo operator string is rejected", () => {
    assert.throws(() => objectIdSchema.parse("$gt"));
  });
});

describe("lib/validation.js — isObjectIdFormat / requireObjectIdFormat (service-layer path-param guard)", () => {
  test("accepts a valid id", () => {
    assert.equal(isObjectIdFormat("507f1f77bcf86cd799439011"), true);
  });
  test("rejects a malformed id", () => {
    assert.equal(isObjectIdFormat("not-an-id"), false);
  });
  test("rejects a non-string", () => {
    assert.equal(isObjectIdFormat(12345), false);
    assert.equal(isObjectIdFormat(null), false);
    assert.equal(isObjectIdFormat(undefined), false);
  });
  test("requireObjectIdFormat throws HttpError(400) for a malformed id", () => {
    assert.throws(() => requireObjectIdFormat("bad-id", "orderId"), /Invalid orderId/);
  });
  test("requireObjectIdFormat does not throw for a valid id", () => {
    assert.doesNotThrow(() => requireObjectIdFormat("507f1f77bcf86cd799439011"));
  });
});

describe("lib/validation.js — assertNoOperatorInjection (Mongo-operator / prototype-pollution guard)", () => {
  test("a plain, ordinary object passes", () => {
    assert.doesNotThrow(() => assertNoOperatorInjection({ name: "Fatima", nested: { city: "Dhaka" } }));
  });
  test("an array of plain objects passes", () => {
    assert.doesNotThrow(() => assertNoOperatorInjection([{ a: 1 }, { b: 2 }]));
  });
  test("a top-level $gt-shaped key is rejected", () => {
    assert.throws(() => assertNoOperatorInjection({ price: { $gt: 0 } }));
  });
  test("a $ne key is rejected", () => {
    assert.throws(() => assertNoOperatorInjection({ status: { $ne: "cancelled" } }));
  });
  test("a $where key is rejected", () => {
    assert.throws(() => assertNoOperatorInjection({ $where: "this.password.length > 0" }));
  });
  test("a nested $where several levels deep is still rejected", () => {
    assert.throws(() => assertNoOperatorInjection({ a: { b: { c: { $where: "1==1" } } } }));
  });
  test("__proto__ is rejected (as it would arrive from a real request body via JSON.parse, which creates a genuine own property, unlike an object literal's special-cased __proto__)", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, "__proto__"), "sanity check: JSON.parse must produce a real own property here, not prototype-set");
    assert.throws(() => assertNoOperatorInjection(parsed));
  });
  test("constructor is rejected", () => {
    assert.throws(() => assertNoOperatorInjection({ constructor: { prototype: {} } }));
  });
  test("prototype is rejected", () => {
    assert.throws(() => assertNoOperatorInjection({ prototype: {} }));
  });
  test("a key containing a literal dot is rejected (dotted-path injection)", () => {
    assert.throws(() => assertNoOperatorInjection({ "items.0.price": 1 }));
  });
  test("an operator smuggled inside an array element is still caught", () => {
    assert.throws(() => assertNoOperatorInjection({ items: [{ ok: 1 }, { $gt: 1 }] }));
  });
});
