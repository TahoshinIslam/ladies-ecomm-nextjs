import { apiSlice } from "./apiSlice.js";
import { buildQueryString } from "../lib/utils.js";

export const productApi = apiSlice.injectEndpoints({
  endpoints: (b) => ({
    getProducts: b.query({
      query: (params = {}) => `/products?${buildQueryString(params)}`,
      providesTags: (result) =>
        result?.products
          ? [
              ...result.products.map(({ _id }) => ({ type: "Product", id: _id })),
              { type: "Product", id: "LIST" },
            ]
          : [{ type: "Product", id: "LIST" }],
    }),
    getFeaturedProducts: b.query({
      query: () => "/products/featured",
      providesTags: [{ type: "Product", id: "FEATURED" }],
    }),
    // Category groupings (departments, or a department's subcategories via
    // { category: topCategoryId }) with live product counts. Was
    // "getProductModels" — sneaker-era model-name filter, replaced.
    getProductGroupings: b.query({
      query: (params = {}) => `/products/models?${buildQueryString(params)}`,
      providesTags: [{ type: "Product", id: "GROUPINGS" }],
    }),
    getProduct: b.query({
      query: (idOrSlug) => `/products/${idOrSlug}`,
      providesTags: (result, err, arg) => [{ type: "Product", id: arg }],
    }),
    getRelatedProducts: b.query({
      query: (arg) => {
        const { id, limit } = typeof arg === "object" && arg !== null ? arg : { id: arg };
        return `/products/${id}/related${limit ? `?limit=${limit}` : ""}`;
      },
      providesTags: (result) =>
        result?.products ? result.products.map(({ _id }) => ({ type: "Product", id: _id })) : [],
    }),
    // Recently Viewed: one request for the whole stored id list instead of
    // one per card. Same shape as getCompareProducts's ids handling.
    getProductsByIds: b.query({
      query: (ids = []) => {
        const list = Array.isArray(ids) ? ids : String(ids).split(",");
        const clean = list.filter(Boolean).join(",");
        return `/products/batch?ids=${encodeURIComponent(clean)}`;
      },
      providesTags: (result) =>
        result?.products ? result.products.map(({ _id }) => ({ type: "Product", id: _id })) : [],
    }),
    getCompareProducts: b.query({
      query: (ids = []) => {
        const list = Array.isArray(ids) ? ids : String(ids).split(",");
        const clean = list.filter(Boolean).join(",");
        return `/products/compare?ids=${encodeURIComponent(clean)}`;
      },
      providesTags: (result) =>
        result?.products
          ? result.products.map(({ _id }) => ({ type: "Product", id: _id }))
          : [],
    }),
    createProduct: b.mutation({
      query: (body) => ({ url: "/products", method: "POST", body }),
      invalidatesTags: [
        { type: "Product", id: "LIST" },
        { type: "Product", id: "MODELS" },
      ],
    }),
    updateProduct: b.mutation({
      query: ({ id, ...body }) => ({ url: `/products/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, a) => [
        { type: "Product", id: a.id },
        { type: "Product", id: "LIST" },
        { type: "Product", id: "MODELS" },
      ],
    }),
    deleteProduct: b.mutation({
      query: (id) => ({ url: `/products/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "Product", id: "LIST" },
        { type: "Product", id: "MODELS" },
      ],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetFeaturedProductsQuery,
  useGetProductGroupingsQuery,
  useGetProductQuery,
  useGetRelatedProductsQuery,
  useGetProductsByIdsQuery,
  useGetCompareProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
} = productApi;
