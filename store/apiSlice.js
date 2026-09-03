import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

const baseUrl = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : "/api";

const baseQuery = fetchBaseQuery({
  baseUrl,
  prepareHeaders: (headers, { getState }) => {
    headers.set("Accept", "application/json");
    const token = getState()?.auth?.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery,
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
