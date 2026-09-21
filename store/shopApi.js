import { apiSlice } from "./apiSlice.js";
import { buildQueryString } from "../lib/utils.js";

// ====== Cart ======
const cartEndpoints = (b) => ({
  getCart: b.query({ query: () => "/cart", providesTags: ["Cart"] }),
  addToCart: b.mutation({
    query: (body) => ({ url: "/cart", method: "POST", body }),
    invalidatesTags: ["Cart"],
  }),
  updateCartItem: b.mutation({
    query: (body) => ({ url: "/cart", method: "PUT", body }),
    invalidatesTags: ["Cart"],
  }),
  removeFromCart: b.mutation({
    query: ({ productId, variantId }) => ({
      url: `/cart/${productId}/${encodeURIComponent(variantId)}`,
      method: "DELETE",
    }),
    invalidatesTags: ["Cart"],
  }),
  clearCart: b.mutation({
    query: () => ({ url: "/cart", method: "DELETE" }),
    invalidatesTags: ["Cart"],
  }),
});

// ====== Wishlist ======
const wishlistEndpoints = (b) => ({
  getWishlist: b.query({
    query: () => "/wishlist",
    providesTags: ["Wishlist"],
  }),
  toggleWishlist: b.mutation({
    query: (productId) => ({ url: `/wishlist/${productId}`, method: "POST" }),
    invalidatesTags: ["Wishlist"],
  }),
  clearWishlist: b.mutation({
    query: () => ({ url: "/wishlist", method: "DELETE" }),
    invalidatesTags: ["Wishlist"],
  }),
});

// ====== Orders ======
const orderEndpoints = (b) => ({
  previewOrder: b.mutation({
    query: (body) => ({ url: "/orders/preview", method: "POST", body }),
  }),
  // Phase 4: `idempotencyKey` is pulled out of the payload and sent as the
  // Idempotency-Key header (never in the body/query string) — the rest of
  // `body` is exactly what CheckoutPage.jsx already sent. The header
  // itself is generated/persisted client-side; see views/CheckoutPage.jsx.
  createOrder: b.mutation({
    query: ({ idempotencyKey, ...body }) => ({
      url: "/orders",
      method: "POST",
      body,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),
    // A new order has no existing per-id tag to invalidate (nothing was
    // cached under its id before this) — only LIST membership changes.
    invalidatesTags: [{ type: "Order", id: "LIST" }, "Cart"],
  }),
  getOrder: b.query({
    query: (id) => `/orders/${id}`,
    providesTags: (r, e, a) => [{ type: "Order", id: a }],
  }),
  cancelOrder: b.mutation({
    query: (id) => ({ url: `/orders/${id}/cancel`, method: "POST" }),
    // The specific order's own tag (its detail query, and any admin list
    // page that currently includes this row) + LIST (a cancellation can
    // move this row out of a status-filtered list view).
    invalidatesTags: (r, e, a) => [{ type: "Order", id: a }, { type: "Order", id: "LIST" }],
  }),
  // Admin
  getAllOrders: b.query({
    query: (params = {}) => `/orders?${buildQueryString(params)}`,
    // Performance audit fix: per-row tags + a LIST tag, replacing the old
    // bare "Order" collection-wide tag every row shared. A mutation on one
    // order (updateOrderStatus/cancelOrder below, or the SSE handler in
    // hooks/useAdminEventStream.js) can now invalidate just that row's
    // tag — which only refetches THIS query if the currently-displayed
    // page/filter actually contains that row — instead of forcing every
    // open admin session's every orders-list page/filter to refetch on any
    // single order change anywhere.
    providesTags: (result) =>
      result?.orders
        ? [...result.orders.map((o) => ({ type: "Order", id: o._id })), { type: "Order", id: "LIST" }]
        : [{ type: "Order", id: "LIST" }],
  }),
});

// ====== Reviews ======
const reviewEndpoints = (b) => ({
  getProductReviews: b.query({
    query: ({ productId, page = 1, limit = 10 }) =>
      `/reviews/product/${productId}?page=${page}&limit=${limit}`,
    providesTags: (r, e, a) => [{ type: "Review", id: a.productId }],
  }),
  // Backs the account "Reviews" page: every delivered product a signed-in
  // shopper can review, plus every review they've already left.
  getMyReviewProducts: b.query({
    query: () => "/reviews/mine",
    providesTags: ["Review"],
  }),
  createReview: b.mutation({
    query: ({ productId, ...body }) => ({
      url: `/reviews/product/${productId}`,
      method: "POST",
      body,
    }),
    // The specific-product tag keeps the PDP's own review list/summary
    // fresh; the bare "Review" tag is what also refreshes
    // getMyReviewProducts above (moving this product from "reviewable" to
    // "reviewed") — updateReview/deleteReview/markHelpful below already
    // invalidate the bare tag, this was the one review mutation that didn't.
    invalidatesTags: (r, e, a) => [
      "Review",
      { type: "Review", id: a.productId },
      { type: "Product", id: a.productId },
    ],
  }),
  updateReview: b.mutation({
    query: ({ id, ...body }) => ({
      url: `/reviews/${id}`,
      method: "PUT",
      body,
    }),
    invalidatesTags: ["Review"],
  }),
  deleteReview: b.mutation({
    query: (id) => ({ url: `/reviews/${id}`, method: "DELETE" }),
    invalidatesTags: ["Review"],
  }),
  markHelpful: b.mutation({
    query: (id) => ({ url: `/reviews/${id}/helpful`, method: "POST" }),
    invalidatesTags: ["Review"],
  }),
});

// ====== Coupons ======
const couponEndpoints = (b) => ({
  validateCoupon: b.mutation({
    query: (body) => ({ url: "/coupons/validate", method: "POST", body }),
  }),
});

// ====== Promotions (admin) ======
const promotionEndpoints = (b) => ({
});

// ====== Addresses ======
const addressEndpoints = (b) => ({
  getMyAddresses: b.query({
    query: () => "/addresses",
    providesTags: ["Address"],
  }),
  createAddress: b.mutation({
    query: (body) => ({ url: "/addresses", method: "POST", body }),
    invalidatesTags: ["Address"],
  }),
  updateAddress: b.mutation({
    query: ({ id, ...body }) => ({
      url: `/addresses/${id}`,
      method: "PUT",
      body,
    }),
    invalidatesTags: ["Address"],
  }),
  deleteAddress: b.mutation({
    query: (id) => ({ url: `/addresses/${id}`, method: "DELETE" }),
    invalidatesTags: ["Address"],
  }),
});

// ====== Payments ====== (COD-only at launch — see services/paymentService.js)
const paymentEndpoints = (b) => ({
  codCreate: b.mutation({
    query: (orderId) => ({ url: `/payments/cod/${orderId}`, method: "POST" }),
  }),
  getPaymentByOrder: b.query({
    query: (orderId) => `/payments/order/${orderId}`,
    providesTags: (r, e, a) => [{ type: "Payment", id: a }],
  }),
});

// Analytics — no RTK Query endpoints here: the one consumer
// (views/admin/OverviewPage.jsx) became a Server Component in Phase 7 and
// now calls services/analyticsService.js directly. Kept as real, tested
// Route Handlers (app/api/analytics/*) independent of this client — this
// only removes the now-zero-consumer client-side wrapper.

// ====== Upload ======
const uploadEndpoints = (b) => ({
});

// ====== Notifications ======
// GET /api/notifications (and the two mutations below) are keyed by
// requireUser() server-side, not requirePermission()/requireStaff() — any
// signed-in user's own notifications, never just admin/employee's. Used
// by both components/admin/NotificationsDropdown.jsx (admin/employee
// broadcasts — new orders, low stock, ...) and the storefront's own
// customer-facing notification bell (order-status/delivery updates, see
// services/notificationService.js's createUserNotification) — one
// endpoint, scoped to whichever user is currently logged in.
const notificationEndpoints = (b) => ({
  getNotifications: b.query({
    query: ({ page = 1, limit = 20, unreadOnly = false } = {}) => {
      const params = new URLSearchParams({ page, limit });
      if (unreadOnly) params.set("unreadOnly", "true");
      return `/notifications?${params.toString()}`;
    },
    providesTags: ["Notification"],
  }),
  markNotificationRead: b.mutation({
    query: (id) => ({ url: `/notifications/${id}/read`, method: "PATCH" }),
    invalidatesTags: ["Notification"],
  }),
  markAllNotificationsRead: b.mutation({
    query: () => ({ url: `/notifications/read-all`, method: "PATCH" }),
    invalidatesTags: ["Notification"],
  }),
});

// ====== Categories / Brands ======
const categoryBrandEndpoints = (b) => ({
  getCategories: b.query({
    query: () => "/categories",
    providesTags: ["Category"],
  }),
  // `{ category: topCategoryId }` scopes the returned brands to that
  // category's real products (see services/productService.js's
  // listBrandsForCategory()) — used by the storefront's Brand filter
  // facet so it never shows an unrelated department's brands. Called with
  // no args, this keeps its original unscoped shape (every active brand),
  // which the admin product form's brand dropdown still relies on.
  getBrands: b.query({ query: (params = {}) => `/brands?${buildQueryString(params)}`, providesTags: ["Brand"] }),
});

// ====== Attributes ======
const attributeEndpoints = (b) => ({
  getAttributes: b.query({
    query: (category) => (category ? `/attributes?category=${category}` : "/attributes"),
    providesTags: ["Attribute"],
  }),
});

export const shopApi = apiSlice.injectEndpoints({
  endpoints: (b) => ({
    ...cartEndpoints(b),
    ...wishlistEndpoints(b),
    ...orderEndpoints(b),
    ...reviewEndpoints(b),
    ...couponEndpoints(b),
    ...promotionEndpoints(b),
    ...addressEndpoints(b),
    ...paymentEndpoints(b),
    ...uploadEndpoints(b),
    ...categoryBrandEndpoints(b),
    ...notificationEndpoints(b),
    ...attributeEndpoints(b),
  }),
});

export const {
  useGetCartQuery,
  useAddToCartMutation,
  useUpdateCartItemMutation,
  useRemoveFromCartMutation,
  useClearCartMutation,
  useGetWishlistQuery,
  useToggleWishlistMutation,
  useClearWishlistMutation,
  usePreviewOrderMutation,
  useCreateOrderMutation,
  useGetOrderQuery,
  useLazyGetOrderQuery,
  useCancelOrderMutation,
  useGetAllOrdersQuery,
  useGetProductReviewsQuery,
  useGetMyReviewProductsQuery,
  useCreateReviewMutation,
  useUpdateReviewMutation,
  useDeleteReviewMutation,
  useMarkHelpfulMutation,
  useValidateCouponMutation,
  useGetMyAddressesQuery,
  useCreateAddressMutation,
  useUpdateAddressMutation,
  useDeleteAddressMutation,
  useCodCreateMutation,
  useGetPaymentByOrderQuery,
  useGetCategoriesQuery,
  useGetBrandsQuery,
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useGetAttributesQuery,
  usePrefetch,
} = shopApi;
