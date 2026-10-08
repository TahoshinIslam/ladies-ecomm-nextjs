// A visitor who is not signed in can save products: they live on the device (guestWishlistSlice), and signing in merges them into the
// account's wishlist with an idempotent add — never a toggle, which would remove anything already saved — dropping each from the device
// only once it is safely in the account. The server half (PUT /api/wishlist/:id) is checked against the test database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import reducer, { guestWishAdd, guestWishRemove, guestWishClear, hydrateGuestWishlist } from "../store/guestWishlistSlice.js";
import { mergeGuestWishlistAfterLogin } from "../hooks/useWishlist.js";
import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
  deleteRows,
} from "./helpers/testDb.mjs";

const p = (id, name = id) => ({ _id: id, name, variants: [] });
const empty = () => reducer(undefined, { type: "@@init" });

describe("guest wishlist (device-side)", () => {
  test("saving adds a product once; saving it again does not duplicate it; the newest is first", () => {
    let s = empty();
    s = reducer(s, guestWishAdd(p("a")));
    s = reducer(s, guestWishAdd(p("b")));
    s = reducer(s, guestWishAdd(p("a")));
    assert.deepEqual(s.items.map((x) => x._id), ["b", "a"]);
  });
  test("removing and clearing", () => {
    let s = reducer(empty(), guestWishAdd(p("a")));
    s = reducer(s, guestWishAdd(p("b")));
    s = reducer(s, guestWishRemove("a"));
    assert.deepEqual(s.items.map((x) => x._id), ["b"]);
    assert.deepEqual(reducer(s, guestWishClear()).items, []);
  });
  test("a product with no id is ignored, and the list is capped", () => {
    let s = reducer(empty(), guestWishAdd({ name: "no id" }));
    assert.equal(s.items.length, 0);
    for (let i = 0; i < 130; i += 1) s = reducer(s, guestWishAdd(p(`p${i}`)));
    assert.equal(s.items.length, 100);
  });
  test("hydrating without browser storage leaves an empty list (server render)", () => {
    assert.deepEqual(reducer(empty(), hydrateGuestWishlist()).items, []);
  });
});

describe("merging saved products into the account after sign-in", () => {
  const fakeDispatch = () => {
    const calls = [];
    const dispatch = (action) => calls.push(action);
    dispatch.calls = calls;
    return dispatch;
  };

  test("each product is added to the account and removed from the device", async () => {
    const dispatch = fakeDispatch();
    const added = [];
    const add = (id) => ({ unwrap: async () => { added.push(id); return { added: true }; } });
    await mergeGuestWishlistAfterLogin(dispatch, add, [p("a"), p("b")]);
    assert.deepEqual(added, ["a", "b"]);
    assert.deepEqual(dispatch.calls.map((c) => c.payload), ["a", "b"]);
  });

  test("a product that fails to merge stays on the device, and the others still merge", async () => {
    const dispatch = fakeDispatch();
    const add = (id) => ({ unwrap: async () => { if (id === "bad") throw new Error("404"); return {}; } });
    await mergeGuestWishlistAfterLogin(dispatch, add, [p("a"), p("bad"), p("c")]);
    assert.deepEqual(dispatch.calls.map((c) => c.payload), ["a", "c"]);
  });

  test("nothing saved means nothing happens", async () => {
    const dispatch = fakeDispatch();
    await mergeGuestWishlistAfterLogin(dispatch, () => { throw new Error("must not be called"); }, []);
    await mergeGuestWishlistAfterLogin(dispatch, () => { throw new Error("must not be called"); }, undefined);
    assert.equal(dispatch.calls.length, 0);
  });
});

describe("PUT /api/wishlist/:productId — an idempotent add for the merge", { skip: !dbReady && skipReason }, () => {
  let PUT, POST, GET;
  before(async () => {
    await connectTestDb();
    ({ PUT, POST } = await import("../app/api/wishlist/[productId]/route.js"));
    ({ GET } = await import("../app/api/wishlist/route.js"));
  });
  after(async () => {
    await disconnectTestDb();
  });

  test("adding twice keeps one entry; a toggle afterwards removes it; signed-out is refused", async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ stock: 3 });
    try {
      const session = await createTestSession(user._id);
      const url = `http://test/api/wishlist/${product._id}`;
      const params = { params: Promise.resolve({ productId: product._id.toString() }) };

      const first = await PUT(requestAs({ method: "PUT", url, session }), params);
      const second = await PUT(requestAs({ method: "PUT", url, session }), params);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const list = await (await GET(requestAs({ method: "GET", url: "http://test/api/wishlist", session }))).json();
      assert.equal(list.wishlist.products.length, 1, "saved once, not twice");

      const toggled = await (await POST(requestAs({ method: "POST", url, session }), params)).json();
      assert.equal(toggled.added, false, "the heart toggles it off again");

      const anon = await PUT(requestAs({ method: "PUT", url, session: null }), params);
      assert.equal(anon.status, 401);
    } finally {
      await deleteRows("wishlists", "customer_id", user._id);
      await deleteRows("customers", "id", user._id);
      await deleteRows("products", "id", product._id);
    }
  });
});
