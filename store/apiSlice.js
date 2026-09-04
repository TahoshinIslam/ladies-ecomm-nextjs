import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { toast } from "sonner";

import { clearCredentials } from "./authSlice.js";
import { translate } from "../lib/i18n/translate.js";
import { LOCALE_COOKIE, DEFAULT_LOCALE, isValidLocale } from "../lib/i18n/config.js";
import { CSRF_COOKIE_NAME } from "../lib/cookies.js";

// This module has no React tree to pull useLocale() from, so the toast
// below reads the same `tahos_locale` cookie LocaleProvider seeds itself
// from (see context/LocaleProvider.jsx) directly.
const currentLocale = () => {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  return isValidLocale(value) ? value : DEFAULT_LOCALE;
};

// Same pattern as currentLocale() above — reads the CSRF cookie directly
// (it's deliberately not HttpOnly, see lib/cookies.js) rather than storing
// its value anywhere in Redux/localStorage. Never read from a URL param.
const readCsrfCookie = () => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const baseUrl = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : "/api";

const rawBaseQuery = fetchBaseQuery({
  baseUrl,
  // Phase 2: cookies carry the session now, not a Redux-held bearer token
  // — the browser needs to actually send the __Host-tahos_session cookie
  // on every same-origin request.
  credentials: "include",
  prepareHeaders: (headers, { type }) => {
    headers.set("Accept", "application/json");
    // Every mutation endpoint in this codebase uses an unsafe HTTP method
    // (POST/PUT/PATCH/DELETE) and every query endpoint uses GET — `type`
    // is a reliable proxy for "unsafe request" here without needing to
    // inspect the resolved method string. Attached unconditionally
    // (even for the unauthenticated auth mutations) since it's harmless
    // when absent — lib/http.js's Layer 2 CSRF check only engages when a
    // session cookie is actually present.
    if (type === "mutation") {
      const csrf = readCsrfCookie();
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    return headers;
  },
});

// A previously-valid session can go stale for entirely ordinary reasons —
// it expired, or got revoked (logout elsewhere, a password reset/change,
// or the account it names was deleted) — and the client's own auth state
// has no way to learn that on its own until the next request 401s. Left
// unhandled, that's a silent dead end — useCart() only falls back to the
// guest cart when Redux's `user` is null, and nothing ever clears a stale
// one, so add to cart/wishlist/checkout all 401 forever with no visible
// sign anything is wrong.
//
// Only reacts when we currently believe we're authenticated — an
// anonymous request to something that requires login (never logged in at
// all) is not a session *expiring* and shouldn't clear/toast. The `id`
// de-dupes the toast when several requests 401 back-to-back (e.g.
// wishlist + cart firing at once).
const baseQueryWithReauth = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error?.status === 401 && api.getState().auth.user) {
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
