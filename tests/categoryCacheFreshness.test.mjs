// A category created in the ERP dashboard (another process, so no revalidateTag) must reach the
// storefront on the very next read, not after the cache's 15-minute TTL: the cached category read is
// keyed by a fingerprint of the categories table.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/serverDataCache.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export async function getCachedCategories"), source.indexOf("export async function getCachedBrands"));

test("the cached category read is keyed by the categories table fingerprint", () => {
  assert.match(body, /Category\.stamp\(\)/);
  assert.match(body, /\["categories",\s*stamp\]/);
});

test("the fingerprint changes when a category is added, moved or (de)activated", () => {
  const model = readFileSync(new URL("../models/categoryModel.js", import.meta.url), "utf8");
  const stampFn = model.slice(model.indexOf("async function stamp"), model.indexOf("async function findByIds"));
  assert.match(stampFn, /COUNT\(\*\)/);
  assert.match(stampFn, /MAX\(updated_at\)/);
  assert.match(stampFn, /SUM\(is_active\)/);
  assert.match(stampFn, /deleted_at IS NULL/);
});
