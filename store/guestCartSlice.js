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
  brand: p.brand,
});

// Snapshot of the specific variant added — this is what makes a cart line
// unique and correct (color/size/fabric, its own price override, its own
// image) instead of the old bare size string that couldn't tell two
// different-colored variants apart. See Phase 4 audit.
const snapshotVariant = (v) => ({
  variantId: v._id,
  sku: v.sku,
  variantName: v.variantName,
  color: v.attributes?.color || "",
  size: v.attributes?.size || "",
  fabric: v.attributes?.fabric || "",
  price: v.price ?? null,
  discountPrice: v.discountPrice ?? null,
  image: v.images?.[0] || "",
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
      const { product, variant, quantity } = payload;
      const existing = s.items.find(
        (i) => i.productId === product._id && i.variantId === variant._id,
      );
      if (existing) {
        existing.quantity += quantity;
      } else {
        s.items.push({
          productId: product._id,
          variantId: variant._id,
          quantity,
          product: snapshotProduct(product),
          variant: snapshotVariant(variant),
        });
      }
      save(s.items);
    },
    guestUpdate: (s, { payload }) => {
      const { productId, variantId, quantity } = payload;
      const item = s.items.find(
        (i) => i.productId === productId && i.variantId === variantId,
      );
      if (!item) return;
      if (quantity <= 0) {
        s.items = s.items.filter(
          (i) => !(i.productId === productId && i.variantId === variantId),
        );
      } else {
        item.quantity = quantity;
      }
      save(s.items);
    },
    guestRemove: (s, { payload }) => {
      const { productId, variantId } = payload;
      s.items = s.items.filter(
        (i) => !(i.productId === productId && i.variantId === variantId),
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
