import { apiSlice } from "./apiSlice.js";
import { buildQueryString } from "../lib/utils.js";

export const userApi = apiSlice.injectEndpoints({
  endpoints: (b) => ({
    register: b.mutation({
      query: (body) => ({ url: "/users/register", method: "POST", body }),
      invalidatesTags: ["User"],
    }),
    login: b.mutation({
      query: (body) => ({ url: "/users/login", method: "POST", body }),
      invalidatesTags: ["User", "Cart", "Wishlist"],
    }),
    logout: b.mutation({
      query: () => ({ url: "/users/logout", method: "POST" }),
      invalidatesTags: ["User", "Cart", "Wishlist"],
    }),
    me: b.query({
      query: () => "/users/me",
      providesTags: ["User"],
    }),
    updateMe: b.mutation({
      query: (body) => ({ url: "/users/me", method: "PUT", body }),
      invalidatesTags: ["User"],
    }),
    forgotPassword: b.mutation({
      query: (body) => ({ url: "/users/forgot-password", method: "POST", body }),
    }),
    resetPassword: b.mutation({
      query: ({ token, password }) => ({
        url: `/users/reset-password/${token}`,
        method: "POST",
        body: { password },
      }),
    }),
    // admin
    listUsers: b.query({
      query: (params = {}) => `/users?${buildQueryString(params)}`,
      // Performance audit fix, same shape as store/shopApi.js's
      // getAllOrders: per-row tags + one LIST tag, replacing a single
      // bare "User" tag every row shared — an edit to one user no longer
      // forces every open admin session's every users-list page/filter
      // to refetch.
      providesTags: (result) =>
        result?.users
          ? [...result.users.map((u) => ({ type: "User", id: u._id })), { type: "User", id: "LIST" }]
          : [{ type: "User", id: "LIST" }],
    }),
    updateUser: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: "PUT", body }),
      // Role changes can move a row across a role-filtered list's
      // boundary — same "id + LIST when membership/filter inclusion can
      // change" rule as Orders' updateOrderStatus.
      invalidatesTags: (r, e, a) => [{ type: "User", id: a.id }, { type: "User", id: "LIST" }],
    }),
    deleteUser: b.mutation({
      query: (id) => ({ url: `/users/${id}`, method: "DELETE" }),
      invalidatesTags: (r, e, a) => [{ type: "User", id: a }, { type: "User", id: "LIST" }],
    }),
  }),
});

export const {
  useRegisterMutation,
  useLoginMutation,
  useLogoutMutation,
  useMeQuery,
  useUpdateMeMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useListUsersQuery,
  useUpdateUserMutation,
  useDeleteUserMutation,
} = userApi;
