// A guest bag keeps a snapshot of each product it holds. That snapshot must keep the product's price currency:
// the bag prices a line from it, and a Taka product that lost the field is read as a still-USD one and converted
// by the exchange rate a second time (৳550 shown as ৳66,000). The server's own snapshot (services/cartService.js)
// has always kept it; the guest one did not.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

describe("Guest bag product snapshot", () => {
  let reducer;
  let guestAdd;
  before(async () => {
    const memory = new Map();
    globalThis.window = { localStorage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) } };
    ({ default: reducer, guestAdd } = await import("../store/guestCartSlice.js"));
  });

  test("a Taka product keeps priceCurrency in the guest bag", () => {
    const product = { _id: "p1", name: "Classic Cotton Shirt", slug: "shirt", images: [], basePrice: 600, discountPrice: null, priceCurrency: "BDT", brand: null };
    const variant = { _id: "v1", sku: "SHIRT-001", variantName: "SHIRT-001", attributes: {}, price: 550, discountPrice: null };
    const state = reducer({ items: [] }, guestAdd({ product, variant, quantity: 50 }));
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].product.priceCurrency, "BDT");
    assert.equal(state.items[0].variant.price, 550);
    assert.equal(state.items[0].quantity, 50);
  });
});
