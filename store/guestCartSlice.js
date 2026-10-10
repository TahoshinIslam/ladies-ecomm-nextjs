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
  // Without it a Taka product in a guest bag reads as a still-USD one and its price is converted a second time
  // (the server's own snapshot, services/cartService.js, keeps it).
  priceCurrency: p.priceCurrency,
  brand: p.brand,
});

// Snapshot of the specific variant added — this is what makes a cart line
// unique and correct (its arbitrary attributes bag, own price override, own
// image) instead of the old bare size string that couldn't tell two
// different-colored variants apart. See Phase 4 audit. Mirrors
// services/cartService.js's snapshotVariant on the server.
const snapshotVariant = (v) => ({
  variantId: v._id,
  sku: v.sku,
  variantName: v.variantName,
  attributes: { ...v.attributes },
  price: v.price ?? null,
  discountPrice: v.discountPrice ?? null,
  image: v.images?.[0] || "",
  // How the item is counted (pieces, or an amount of kg/g/l/ml in steps of its smallest pack) — the bag shows and steps it.
  unit: v.unit || "pc",
  step: v.step || 1,
});

// Amounts are kept to three decimals (0.5 kg + 0.5 kg is 1 kg, never 0.9999999).
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

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
        existing.quantity = round3(existing.quantity + quantity);
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
        item.quantity = round3(quantity);
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
  state.guestCart.items.reduce((n, i) => n + Math.ceil(i.quantity), 0);

export default guestCartSlice.reducer;
