import { apiSlice } from "./apiSlice.js";

export const themeApi = apiSlice.injectEndpoints({
  endpoints: (b) => ({
    getActiveTheme: b.query({
      query: () => "/theme/active",
      providesTags: [{ type: "Theme", id: "ACTIVE" }],
    }),
  }),
});

export const {
  useGetActiveThemeQuery,
} = themeApi;
