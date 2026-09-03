import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { toast } from "sonner";

import { clearCredentials } from "./authSlice.js";
import { translate } from "../lib/i18n/translate.js";
import { LOCALE_COOKIE, DEFAULT_LOCALE, isValidLocale } from "../lib/i18n/config.js";

// This module has no React tree to pull useLocale() from, so the toast
// below reads the same `tahos_locale` cookie LocaleProvider seeds itself
// from (see context/LocaleProvider.jsx) directly.
const currentLocale = () => {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  return isValidLocale(value) ? value : DEFAULT_LOCALE;
};

const baseUrl = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : "/api";

const rawBaseQuery = fetchBaseQuery({
  baseUrl,
  prepareHeaders: (headers, { getState }) => {
    headers.set("Accept", "application/json");
    const token = getState()?.auth?.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

// A previously-issued JWT can go stale for entirely ordinary reasons — it
// expired, the server's JWT_SECRET rotated, the account it names was
// deleted — and the client's own auth state (mirrored into localStorage by
// authSlice, restored on every reload by hydrateAuth()) has no way to
// learn that on its own: it just keeps showing "signed in" and keeps
// sending the now-rejected token on every request. Left unhandled, that's
// a silent dead end — useCart() only falls back to the guest cart when
// Redux's `user` is null, and nothing ever clears a stale one, so add to
// cart/wishlist/checkout all 401 forever with no visible sign anything is
// wrong (see lib/auth.js's userFromToken → jwt.verify, and lib/http.js's
// JsonWebTokenError → "Invalid token" mapping).
//
// Only reacts when a token was actually attached — an anonymous request to
// something that requires login (never logged in at all) is not a session
// *expiring* and shouldn't clear/toast. The `id` de-dupes the toast when
// several requests 401 back-to-back (e.g. wishlist + cart firing at once).
const baseQueryWithReauth = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error?.status === 401 && api.getState().auth.token) {
    api.dispatch(clearCredentials());
    toast.error(translate(currentLocale(), "errors.sessionExpired"), { id: "session-expired" });
  }
  return result;
};

export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
  keepUnusedDataFor: 300,
  refetchOnMountOrArgChange: false,
  refetchOnReconnect: true,
  tagTypes: [
    "User",
    "Product",
    "Category",
    "Brand",
    "Cart",
    "Wishlist",
    "Order",
    "Review",
    "Address",
    "Coupon",
    "Payment",
    "Theme",
    "Analytics",
    "Notification",
    "Attribute",
  ],
  endpoints: () => ({}),
});
