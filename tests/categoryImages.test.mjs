// The dashboard saves a category's home-page picture by category id; the storefront draws pictures by category slug. This is the bridge
// — and the reason a picture set in the dashboard actually shows up.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { departmentImagesBySlug } from "../lib/categoryImages.js";

const categories = [
  { _id: "c1", slug: "burqa" },
  { _id: "c2", slug: "abaya" },
  { _id: "c3", slug: "hijab" },
];

describe("departmentImagesBySlug", () => {
  test("a picture saved in the dashboard (by category id) appears under that category's slug", () => {
    assert.deepEqual(departmentImagesBySlug({ categoryImages: { c1: "/files/fil_a" } }, categories), { burqa: "/files/fil_a" });
  });
  test("the dashboard's pick wins over the older per-slug map; the older map fills in the rest", () => {
    const out = departmentImagesBySlug(
      { departmentImages: { burqa: "https://old/b.png", abaya: "https://old/a.png" }, categoryImages: { c1: "/files/fil_new" } },
      categories,
    );
    assert.deepEqual(out, { burqa: "/files/fil_new", abaya: "https://old/a.png" });
  });
  test("a blank or missing picture never erases an existing one, and an unknown category id is ignored", () => {
    const out = departmentImagesBySlug({ departmentImages: { hijab: "https://old/h.png" }, categoryImages: { c3: "  ", zzz: "/files/x" } }, categories);
    assert.deepEqual(out, { hijab: "https://old/h.png" });
  });
  test("nothing configured is an empty map, not an error", () => {
    assert.deepEqual(departmentImagesBySlug(undefined, undefined), {});
    assert.deepEqual(departmentImagesBySlug({}, categories), {});
  });
});
