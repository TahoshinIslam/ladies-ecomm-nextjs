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
    invalidatesTags: ["Order", "Cart"],
  }),
  getMyOrders: b.query({ query: () => "/orders/my", providesTags: ["Order"] }),
  getOrder: b.query({
    query: (id) => `/orders/${id}`,
    providesTags: (r, e, a) => [{ type: "Order", id: a }],
  }),
  cancelOrder: b.mutation({
    query: (id) => ({ url: `/orders/${id}/cancel`, method: "POST" }),
    invalidatesTags: (r, e, a) => [{ type: "Order", id: a }, "Order"],
  }),
  // Admin
  getAllOrders: b.query({
    query: (params = {}) => `/orders?${buildQueryString(params)}`,
    providesTags: ["Order"],
  }),
  updateOrderStatus: b.mutation({
    query: ({ id, ...body }) => ({
      url: `/orders/${id}/status`,
      method: "PUT",
      body,
    }),
    invalidatesTags: (r, e, a) => [{ type: "Order", id: a.id }, "Order"],
  }),
});

// ====== Reviews ======
const reviewEndpoints = (b) => ({
  getProductReviews: b.query({
    query: ({ productId, page = 1, limit = 10 }) =>
      `/reviews/product/${productId}?page=${page}&limit=${limit}`,
    providesTags: (r, e, a) => [{ type: "Review", id: a.productId }],
  }),
  createReview: b.mutation({
    query: ({ productId, ...body }) => ({
      url: `/reviews/product/${productId}`,
      method: "POST",
      body,
    }),
    invalidatesTags: (r, e, a) => [
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
  // Admin
  listAllReviews: b.query({
    query: (params = {}) => `/reviews?${buildQueryString(params)}`,
    providesTags: ["Review"],
  }),
  replyToReview: b.mutation({
    query: ({ id, text }) => ({
      url: `/reviews/${id}/reply`,
      method: "POST",
      body: { text },
    }),
    invalidatesTags: ["Review"],
  }),
});

// ====== Coupons ======
const couponEndpoints = (b) => ({
  validateCoupon: b.mutation({
    query: (body) => ({ url: "/coupons/validate", method: "POST", body }),
  }),
  listCoupons: b.query({
    query: (params = {}) => `/coupons?${buildQueryString(params)}`,
    providesTags: ["Coupon"],
  }),
  createCoupon: b.mutation({
    query: (body) => ({ url: "/coupons", method: "POST", body }),
    invalidatesTags: ["Coupon"],
  }),
  updateCoupon: b.mutation({
    query: ({ id, ...body }) => ({
      url: `/coupons/${id}`,
      method: "PUT",
      body,
    }),
    invalidatesTags: ["Coupon"],
  }),
  deleteCoupon: b.mutation({
    query: (id) => ({ url: `/coupons/${id}`, method: "DELETE" }),
    invalidatesTags: ["Coupon"],
  }),
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

// ====== Payments ======
const paymentEndpoints = (b) => ({
  stripeCheckout: b.mutation({
    query: (orderId) => ({
      url: `/payments/stripe/${orderId}`,
      method: "POST",
    }),
  }),
  bkashCreate: b.mutation({
    query: (orderId) => ({
      url: `/payments/bkash/create/${orderId}`,
      method: "POST",
    }),
  }),
  bkashExecute: b.mutation({
    query: (body) => ({ url: "/payments/bkash/execute", method: "POST", body }),
  }),
  nagadCreate: b.mutation({
    query: (orderId) => ({
      url: `/payments/nagad/create/${orderId}`,
      method: "POST",
    }),
  }),
  codCreate: b.mutation({
    query: (orderId) => ({ url: `/payments/cod/${orderId}`, method: "POST" }),
  }),
  getPaymentByOrder: b.query({
    query: (orderId) => `/payments/order/${orderId}`,
    providesTags: (r, e, a) => [{ type: "Payment", id: a }],
  }),
});

// ====== Analytics ======
const analyticsEndpoints = (b) => ({
  getOverview: b.query({
    query: () => "/analytics/overview",
    providesTags: ["Analytics"],
  }),
  getSalesSeries: b.query({
    query: (days = 30) => `/analytics/sales-series?days=${days}`,
    providesTags: ["Analytics"],
  }),
  getTopProducts: b.query({
    query: (limit = 10) => `/analytics/top-products?limit=${limit}`,
    providesTags: ["Analytics"],
  }),
  getStatusBreakdown: b.query({
    query: () => "/analytics/status-breakdown",
    providesTags: ["Analytics"],
  }),
  getRevenueByMethod: b.query({
    query: () => "/analytics/revenue-by-method",
    providesTags: ["Analytics"],
  }),
});

// ====== Upload ======
const uploadEndpoints = (b) => ({
  uploadImage: b.mutation({
    query: ({ file, folder = "shoestore" }) => {
      const fd = new FormData();
      fd.append("image", file);
      return {
        url: `/upload?folder=${encodeURIComponent(folder)}`,
        method: "POST",
        body: fd,
      };
    },
  }),
  uploadMultiple: b.mutation({
    query: ({ files, folder = "shoestore" }) => {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      return {
        url: `/upload/multiple?folder=${encodeURIComponent(folder)}`,
        method: "POST",
        body: fd,
      };
    },
  }),
});

// ====== Notifications (admin/employee) ======
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
  createCategory: b.mutation({
    query: (body) => ({ url: "/categories", method: "POST", body }),
    invalidatesTags: ["Category"],
  }),
  updateCategory: b.mutation({
    query: ({ id, ...body }) => ({
      url: `/categories/${id}`,
      method: "PUT",
      body,
    }),
    invalidatesTags: ["Category"],
  }),
  deleteCategory: b.mutation({
    query: (id) => ({ url: `/categories/${id}`, method: "DELETE" }),
    invalidatesTags: ["Category"],
  }),
  getBrands: b.query({ query: () => "/brands", providesTags: ["Brand"] }),
  createBrand: b.mutation({
    query: (body) => ({ url: "/brands", method: "POST", body }),
    invalidatesTags: ["Brand"],
  }),
  updateBrand: b.mutation({
    query: ({ id, ...body }) => ({ url: `/brands/${id}`, method: "PUT", body }),
    invalidatesTags: ["Brand"],
  }),
  deleteBrand: b.mutation({
    query: (id) => ({ url: `/brands/${id}`, method: "DELETE" }),
    invalidatesTags: ["Brand"],
  }),
});

// ====== Attributes ======
const attributeEndpoints = (b) => ({
  getAttributes: b.query({
    query: (category) => (category ? `/attributes?category=${category}` : "/attributes"),
    providesTags: ["Attribute"],
  }),
  createAttribute: b.mutation({
    query: (body) => ({ url: "/attributes", method: "POST", body }),
    invalidatesTags: ["Attribute"],
  }),
  updateAttribute: b.mutation({
    query: ({ id, ...body }) => ({ url: `/attributes/${id}`, method: "PUT", body }),
    invalidatesTags: ["Attribute"],
  }),
  deleteAttribute: b.mutation({
    query: (id) => ({ url: `/attributes/${id}`, method: "DELETE" }),
    invalidatesTags: ["Attribute"],
  }),
});

export const shopApi = apiSlice.injectEndpoints({
  endpoints: (b) => ({
    ...cartEndpoints(b),
    ...wishlistEndpoints(b),
    ...orderEndpoints(b),
    ...reviewEndpoints(b),
    ...couponEndpoints(b),
    ...addressEndpoints(b),
    ...paymentEndpoints(b),
    ...analyticsEndpoints(b),
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
  useGetMyOrdersQuery,
  useGetOrderQuery,
  useLazyGetOrderQuery,
  useCancelOrderMutation,
  useGetAllOrdersQuery,
  useUpdateOrderStatusMutation,
  useGetProductReviewsQuery,
  useCreateReviewMutation,
  useUpdateReviewMutation,
  useDeleteReviewMutation,
  useMarkHelpfulMutation,
  useListAllReviewsQuery,
  useReplyToReviewMutation,
  useValidateCouponMutation,
  useListCouponsQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
  useGetMyAddressesQuery,
  useCreateAddressMutation,
  useUpdateAddressMutation,
  useDeleteAddressMutation,
  useStripeCheckoutMutation,
  useBkashCreateMutation,
  useBkashExecuteMutation,
  useNagadCreateMutation,
  useCodCreateMutation,
  useGetPaymentByOrderQuery,
  useGetOverviewQuery,
  useGetSalesSeriesQuery,
  useGetTopProductsQuery,
  useGetStatusBreakdownQuery,
  useGetRevenueByMethodQuery,
  useUploadImageMutation,
  useUploadMultipleMutation,
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useGetBrandsQuery,
  useCreateBrandMutation,
  useUpdateBrandMutation,
  useDeleteBrandMutation,
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useGetAttributesQuery,
  useCreateAttributeMutation,
  useUpdateAttributeMutation,
  useDeleteAttributeMutation,
} = shopApi;
