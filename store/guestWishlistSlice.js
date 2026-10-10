import { createSlice } from "@reduxjs/toolkit";

import { storage } from "../lib/utils.js";

// A visitor who is not signed in can still save products. They live on this device (localStorage) as a snapshot of each product — enough
// for the product card to draw it — and are added to the account's own wishlist when the visitor signs in or registers
// (hooks/useWishlist.js mergeGuestWishlistAfterLogin).
const KEY = "ss:guestWishlist";
const MAX_ITEMS = 100;

const load = () => {
  const parsed = storage.getJSON(KEY, []);
  return Array.isArray(parsed) ? parsed.filter((p) => p && p._id) : [];
};
const save = (items) => storage.setJSON(KEY, items);

const guestWishlistSlice = createSlice({
  name: "guestWishlist",
  // Empty until the client mounts (see hydrateGuestWishlist) so the server's first render and the client's agree.
  initialState: { items: [] },
  reducers: {
    hydrateGuestWishlist: (s) => {
      s.items = load();
    },
    guestWishAdd: (s, { payload: product }) => {
      if (!product?._id || s.items.some((p) => p._id === product._id)) return;
      s.items.unshift(product);
      s.items = s.items.slice(0, MAX_ITEMS);
      save(s.items);
    },
    guestWishRemove: (s, { payload: productId }) => {
      s.items = s.items.filter((p) => p._id !== productId);
      save(s.items);
    },
    guestWishClear: (s) => {
      s.items = [];
      save(s.items);
    },
  },
});

export const { hydrateGuestWishlist, guestWishAdd, guestWishRemove, guestWishClear } = guestWishlistSlice.actions;
export const selectGuestWishlist = (state) => state.guestWishlist.items;
export default guestWishlistSlice.reducer;
