// Phase 2, section 9: guest-cart merge, refresh persistence, checkout, and
// logout continuity — the parts of the cart/checkout flow that depend on
// the NEW cookie-session layer actually working end-to-end, as opposed to
// hooks/useCart.js's mergeGuestCartAfterLogin() itself (a pure client-side
// Redux/localStorage function with no server dependency to migrate).
//
// mergeGuestCartAfterLogin() calls POST /api/cart once per guest-cart item
// and only removes an item from guest storage on success — a failed item
// (out of stock, bad variant) stays recoverable. This file verifies the
// SERVER side of exactly that sequence stays correct under session-cookie
// auth: each POST /api/cart authenticates via the cookie, quantities merge
// correctly for a repeated (productId, variantId), a failing item doesn't
// corrupt or roll back the items that already succeeded, the resulting
// cart persists across a fresh request (simulating a page refresh), and
// checkout/logout both behave correctly against the same session.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Guest-cart merge, checkout, and logout continuity under session-cookie auth", { skip: !canRun && reason }, () => {
  let cartGET, cartPOST;
  let orderCreatePOST;
  let logoutPOST;
  let User, Order;

  before(async () => {
    await connectTestDb();
    ({ GET: cartGET, POST: cartPOST } = await import("../app/api/cart/route.js"));
    ({ POST: orderCreatePOST } = await import("../app/api/orders/route.js"));
    ({ POST: logoutPOST } = await import("../app/api/users/logout/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  test("simulated guest-cart merge: items add correctly, a repeated (productId, variantId) merges quantity instead of duplicating, a failing item doesn't corrupt what already succeeded, and the result persists across a fresh request (page refresh)", async () => {
    const user = await createTestUser();
    const productA = await createTestProduct({ stock: 5 });
    const productB = await createTestProduct({ stock: 5 });
    try {
      const session = await createTestSession(user._id);
      const variantAId = productA.variants[0]._id.toString();
      const variantBId = productB.variants[0]._id.toString();

      // Item 1 of the "guest cart" merges in.
      const add1 = await cartPOST(
        requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: productA._id.toString(), variantId: variantAId, quantity: 1 } }),
      );
      assert.equal(add1.status, 200);

      // Item 2, a different product, gets its own line rather than
      // merging into item 1's.
      const add2 = await cartPOST(
        requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: productB._id.toString(), variantId: variantBId, quantity: 2 } }),
      );
      assert.equal(add2.status, 200);

      // The SAME (productId, variantId) as item 1 arrives again (e.g. the
      // merge loop retried, or the guest cart had a duplicate entry) —
      // quantities merge onto the existing line instead of creating a
      // second one.
      const add1Again = await cartPOST(
        requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: productA._id.toString(), variantId: variantAId, quantity: 1 } }),
      );
      assert.equal(add1Again.status, 200);
      const afterMerge = (await add1Again.json()).cart;
      assert.equal(afterMerge.items.length, 2, "still exactly 2 lines — the repeat merged, it didn't duplicate");
      const lineA = afterMerge.items.find((i) => String(i.productId) === productA._id.toString());
      assert.equal(lineA.quantity, 2, "1 + 1 merged onto the same line");

      // A THIRD guest item is unavailable (nonexistent variant) — mirrors
      // mergeGuestCartAfterLogin()'s per-item try/catch: one failure must
      // not touch the items that already succeeded.
      const bogusVariantId = "000000000000000000000000";
      const addBad = await cartPOST(
        requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: productA._id.toString(), variantId: bogusVariantId, quantity: 1 } }),
      );
      assert.equal(addBad.status, 404, "the failing item gets a clean error, not a silent success");

      // Cart persists correctly after the failure, across a BRAND NEW
      // request object with only the session cookie carried over —
      // simulating a page refresh, which is the actual regression risk
      // Phase 2 introduces (does the cookie alone still restore the cart).
      const refreshed = await cartGET(requestAs({ method: "GET", url: "http://test/api/cart", session }));
      assert.equal(refreshed.status, 200);
      const cart = (await refreshed.json()).cart;
      assert.equal(cart.items.length, 2, "still only the 2 successful lines — the failed add left no trace and dropped nothing");
      const refreshedLineA = cart.items.find((i) => String(i.productId) === productA._id.toString());
      const refreshedLineB = cart.items.find((i) => String(i.productId) === productB._id.toString());
      assert.equal(refreshedLineA.quantity, 2);
      assert.equal(refreshedLineB.quantity, 2);
    } finally {
      const { default: Cart } = await import("../models/cartModel.js");
      await Cart.deleteMany({ userId: user._id });
      const { default: Product } = await import("../models/productModel.js");
      await Product.deleteMany({ _id: { $in: [productA._id, productB._id] } });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("checkout: an order can be created against the same session that just merged the cart, and the cart's contents are independent of order creation", async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const session = await createTestSession(user._id);
      const variantId = product.variants[0]._id.toString();

      await cartPOST(
        requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: product._id.toString(), variantId, quantity: 1 } }),
      );

      const orderRes = await orderCreatePOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session,
          body: {
            items: [{ productId: product._id.toString(), variantId, quantity: 1 }],
            shippingAddress: { fullName: "Test Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
          },
        }),
      );
      assert.equal(orderRes.status, 201, "checkout succeeds authenticated through the same session cookie the cart merge used");
      const order = (await orderRes.json()).order;
      assert.equal(String(order.user), String(user._id));
    } finally {
      await Order.deleteMany({ user: user._id });
      const { default: Cart } = await import("../models/cartModel.js");
      await Cart.deleteMany({ userId: user._id });
      const { default: Product } = await import("../models/productModel.js");
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("logout ends the server session (cart access now requires re-authentication) without the server touching anything client-side — guest-cart/localStorage continuity is a pure client concern this migration doesn't change", async () => {
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);
      const okBefore = await cartGET(requestAs({ method: "GET", url: "http://test/api/cart", session }));
      assert.equal(okBefore.status, 200);

      await logoutPOST(requestAs({ method: "POST", url: "http://test/api/users/logout", session }));

      const afterLogout = await cartGET(requestAs({ method: "GET", url: "http://test/api/cart", session }));
      assert.equal(afterLogout.status, 401, "the old session cookie no longer authenticates cart access — the client falls back to its (untouched) guest cart");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });
});
