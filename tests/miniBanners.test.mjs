// The small banners beside the homepage carousel are real, buyable products — never invented offers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pickMiniBannerProducts, buildMiniBannerSlots } from "../lib/miniBanners.js";

const p = (id, { base = 100, discount = null, stock = 5 } = {}) => ({ _id: id, basePrice: base, discountPrice: discount, variants: [{ stock }] });

describe("pickMiniBannerProducts", () => {
  test("discounted products come first, then the rest of the featured, then new arrivals", () => {
    const featured = [p("f-plain"), p("f-sale", { discount: 80 })];
    const arrivals = [p("n-sale", { discount: 90 }), p("n-plain")];
    assert.deepEqual(pickMiniBannerProducts(featured, arrivals).map((x) => x._id), ["f-sale", "n-sale", "f-plain"]);
  });
  test("never more than three, and never the same product twice", () => {
    const a = p("a", { discount: 50 });
    const picked = pickMiniBannerProducts([a, p("b"), p("c"), p("d")], [a, p("e")]);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked.map((x) => x._id)).size, 3);
  });
  test("a product nobody can buy (every variant out of stock) is never shown", () => {
    const picked = pickMiniBannerProducts([p("sold-out", { discount: 50, stock: 0 }), p("ok")], []);
    assert.deepEqual(picked.map((x) => x._id), ["ok"]);
  });
  test("a discount that is not a real discount (price not below the base price) does not jump the queue", () => {
    const picked = pickMiniBannerProducts([p("plain-first"), p("fake-sale", { base: 100, discount: 100 })], []);
    assert.deepEqual(picked.map((x) => x._id), ["plain-first", "fake-sale"]);
  });
  test("fewer buyable products than banners means fewer banners, and none at all is an empty list", () => {
    assert.equal(pickMiniBannerProducts([p("only")], []).length, 1);
    assert.deepEqual(pickMiniBannerProducts([], []), []);
    assert.deepEqual(pickMiniBannerProducts(), []);
  });
});

describe("buildMiniBannerSlots — owner pictures win their slot, products fill the rest", () => {
  const prods = [p("a"), p("b"), p("c")];
  test("with nothing configured, the three slots are the first three products", () => {
    const slots = buildMiniBannerSlots([], prods);
    assert.deepEqual(slots.map((s) => [s.kind, s.product._id]), [["product", "a"], ["product", "b"], ["product", "c"]]);
  });
  test("a configured slot keeps its position; an empty one takes the next product", () => {
    const slots = buildMiniBannerSlots([{ imageUrl: "/files/one", href: "/shop" }, { imageUrl: "", href: "" }, { imageUrl: "/files/three", href: "/shop?collection=new" }], prods);
    assert.deepEqual(slots.map((s) => s.kind), ["image", "product", "image"]);
    assert.equal(slots[1].product._id, "a");
    assert.equal(slots[2].href, "/shop?collection=new");
  });
  test("a link that leaves the shop (full URL, //host) is replaced by /shop; a blank link also goes to /shop", () => {
    const slots = buildMiniBannerSlots([{ imageUrl: "/files/x", href: "https://evil.test" }, { imageUrl: "/files/y", href: "//evil.test" }, { imageUrl: "/files/z", href: "" }], []);
    assert.deepEqual(slots.map((s) => s.href), ["/shop", "/shop", "/shop"]);
  });
  test("never more than three slots, and nothing configured plus no products is an empty list", () => {
    assert.equal(buildMiniBannerSlots([{ imageUrl: "/a" }, { imageUrl: "/b" }, { imageUrl: "/c" }, { imageUrl: "/d" }], prods).length, 3);
    assert.deepEqual(buildMiniBannerSlots(undefined, []), []);
  });
});
