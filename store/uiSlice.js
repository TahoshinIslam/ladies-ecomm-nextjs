import { createSlice } from "@reduxjs/toolkit";

import { storage } from "../lib/utils.js";

const COMPARE_KEY = "ss:compare";

const initialState = {
  cartOpen: false,
  searchOpen: false,
  mobileMenuOpen: false,
  // Starts empty on both server and client so the two first renders match;
  // the persisted list is applied by hydrateUi after mount.
  compareList: [],
  // Single shared QuickAddSheet instance (mounted once in the storefront
  // layout) rather than one per ProductCard — holds the product it's
  // currently open for, or null when closed.
  quickAddProduct: null,
  finderOpen: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    hydrateUi: (s) => {
      const saved = storage.getJSON(COMPARE_KEY, []);
      s.compareList = Array.isArray(saved) ? saved.slice(0, 4) : [];
    },
    toggleCart: (s) => {
      s.cartOpen = !s.cartOpen;
    },
    setCartOpen: (s, { payload }) => {
      s.cartOpen = payload;
    },
    toggleSearch: (s) => {
      s.searchOpen = !s.searchOpen;
    },
    setSearchOpen: (s, { payload }) => {
      s.searchOpen = payload;
    },
    toggleMobileMenu: (s) => {
      s.mobileMenuOpen = !s.mobileMenuOpen;
    },
    setMobileMenuOpen: (s, { payload }) => {
      s.mobileMenuOpen = payload;
    },
    addToCompare: (s, { payload }) => {
      if (s.compareList.includes(payload)) return;
      if (s.compareList.length >= 4) s.compareList.shift();
      s.compareList.push(payload);
      storage.setJSON(COMPARE_KEY, s.compareList);
    },
    removeFromCompare: (s, { payload }) => {
      s.compareList = s.compareList.filter((id) => id !== payload);
      storage.setJSON(COMPARE_KEY, s.compareList);
    },
    clearCompare: (s) => {
      s.compareList = [];
      storage.remove(COMPARE_KEY);
    },
    openQuickAdd: (s, { payload }) => {
      s.quickAddProduct = payload;
    },
    closeQuickAdd: (s) => {
      s.quickAddProduct = null;
    },
    setFinderOpen: (s, { payload }) => {
      s.finderOpen = payload;
    },
  },
});

export const {
  hydrateUi,
  toggleCart,
  setCartOpen,
  toggleSearch,
  setSearchOpen,
  toggleMobileMenu,
  setMobileMenuOpen,
  addToCompare,
  removeFromCompare,
  clearCompare,
  openQuickAdd,
  closeQuickAdd,
  setFinderOpen,
} = uiSlice.actions;

export default uiSlice.reducer;
