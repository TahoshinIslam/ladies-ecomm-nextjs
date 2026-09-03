import { apiSlice } from "./apiSlice.js";

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
    verifyEmail: b.query({
      query: (token) => `/users/verify-email/${token}`,
    }),
    // admin
    listUsers: b.query({ query: () => "/users", providesTags: ["User"] }),
    updateUser: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: "PUT", body }),
      invalidatesTags: ["User"],
    }),
    deleteUser: b.mutation({
      query: (id) => ({ url: `/users/${id}`, method: "DELETE" }),
      invalidatesTags: ["User"],
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
  useVerifyEmailQuery,
  useListUsersQuery,
  useUpdateUserMutation,
  useDeleteUserMutation,
} = userApi;
