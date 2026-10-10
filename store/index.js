import { configureStore } from "@reduxjs/toolkit";
import { apiSlice } from "./apiSlice.js";
// Importing these ensures injectEndpoints runs
import "./userApi.js";
import "./productApi.js";
import "./themeApi.js";
import "./shopApi.js";

import authReducer from "./authSlice.js";
import uiReducer from "./uiSlice.js";
import guestCartReducer from "./guestCartSlice.js";
import guestWishlistReducer from "./guestWishlistSlice.js";

const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    guestCart: guestCartReducer,
    guestWishlist: guestWishlistReducer,
    [apiSlice.reducerPath]: apiSlice.reducer,
  },
  middleware: (getDefault) =>
    getDefault({ serializableCheck: { ignoredActions: [] } }).concat(apiSlice.middleware),
  devTools: process.env.NODE_ENV !== "production",
});

export default store;
