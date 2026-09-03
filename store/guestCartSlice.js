import { createSlice } from "@reduxjs/toolkit";

import { storage } from "../lib/utils.js";

const KEY = "ss:guestCart";

const load = () => {
  const parsed = storage.getJSON(KEY, []);
  return Array.isArray(parsed) ? parsed : [];
};

const save = (items) => {
  storage.setJSON(KEY, items);
};

const snapshotProduct = (p) => ({
  _id: p._id,
  name: p.name,
  slug: p.slug,
  images: p.images,
  basePrice: p.basePrice,
  discountPrice: p.discountPrice,
  // `variants` is the modest-fashion schema; `sizes` is the legacy
  // mock-catalog shape — snapshot whichever the product actually has.
  sizes: p.sizes,
  variants: p.variants,
  brand: p.brand,
  colorway: p.colorway,
});

const guestCartSlice = createSlice({
  name: "guestCart",
  // Empty until the client mounts — see hydrateGuestCart. Loading here would
  // make the server's first render (always empty) disagree with the client's.
  initialState: { items: [] },
  reducers: {
    hydrateGuestCart: (s) => {
      s.items = load();
    },
    guestAdd: (s, { payload }) => {
      const { product, size, quantity } = payload;
      const existing = s.items.find(
        (i) => i.productId === product._id && i.size === size,
      );
      if (existing) {
        existing.quantity += quantity;
      } else {
        s.items.push({
          productId: product._id,
          size,
          quantity,
          product: snapshotProduct(product),
        });
      }
      save(s.items);
    },
    guestUpdate: (s, { payload }) => {
      const { productId, size, quantity } = payload;
      const item = s.items.find(
        (i) => i.productId === productId && i.size === size,
      );
      if (!item) return;
      if (quantity <= 0) {
        s.items = s.items.filter(
          (i) => !(i.productId === productId && i.size === size),
        );
      } else {
        item.quantity = quantity;
      }
      save(s.items);
    },
    guestRemove: (s, { payload }) => {
      const { productId, size } = payload;
      s.items = s.items.filter(
        (i) => !(i.productId === productId && i.size === size),
      );
      save(s.items);
    },
    guestClear: (s) => {
      s.items = [];
      save(s.items);
    },
  },
});

export const { hydrateGuestCart, guestAdd, guestUpdate, guestRemove, guestClear } =
  guestCartSlice.actions;

export const selectGuestItems = (state) => state.guestCart.items;
export const selectGuestCount = (state) =>
  state.guestCart.items.reduce((n, i) => n + i.quantity, 0);

export default guestCartSlice.reducer;
