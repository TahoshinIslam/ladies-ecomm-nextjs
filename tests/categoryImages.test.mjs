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

import { sortDepartmentsForFavourites } from "../lib/storefrontDepartments.js";

describe("sortDepartmentsForFavourites — a shop with its own categories still gets a tile row", () => {
  test("the built-in department set is used, in its own order, when the shop has it", () => {
    const out = sortDepartmentsForFavourites([
      { _id: "1", slug: "hijab" },
      { _id: "2", slug: "burqa" },
      { _id: "3", slug: "fruits" },
    ]);
    assert.deepEqual(out.map((c) => c.slug), ["burqa", "hijab"]);
  });
  test("otherwise the shop's own top-level categories, in the owner's order (nested and hidden ones left out)", () => {
    const out = sortDepartmentsForFavourites([
      { _id: "a", slug: "fruits", name: "Fruits", sortOrder: 2 },
      { _id: "b", slug: "beauty", name: "Beauty & Health", sortOrder: 1 },
      { _id: "c", slug: "fresh-fruits", name: "Fresh Fruits", parent: "a", sortOrder: 0 },
      { _id: "d", slug: "hidden", name: "Hidden", sortOrder: 0, isActive: false },
    ]);
    assert.deepEqual(out.map((c) => c.slug), ["beauty", "fruits"]);
  });
  test("no categories at all is an empty row, not an error", () => {
    assert.deepEqual(sortDepartmentsForFavourites([]), []);
  });
});
