import { apiSlice } from "./apiSlice.js";

export const themeApi = apiSlice.injectEndpoints({
  endpoints: (b) => ({
    getActiveTheme: b.query({
      query: () => "/theme/active",
      providesTags: [{ type: "Theme", id: "ACTIVE" }],
    }),
    // Admin
    listThemes: b.query({
      query: () => "/theme",
      providesTags: (r) =>
        r?.themes
          ? [
              ...r.themes.map((t) => ({ type: "Theme", id: t._id })),
              { type: "Theme", id: "LIST" },
            ]
          : [{ type: "Theme", id: "LIST" }],
    }),
    getTheme: b.query({
      query: (id) => `/theme/${id}`,
      providesTags: (r, e, a) => [{ type: "Theme", id: a }],
    }),
    createTheme: b.mutation({
      query: (body) => ({ url: "/theme", method: "POST", body }),
      invalidatesTags: [{ type: "Theme", id: "LIST" }],
    }),
    updateTheme: b.mutation({
      query: ({ id, ...body }) => ({ url: `/theme/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, a) => [
        { type: "Theme", id: a.id },
        { type: "Theme", id: "LIST" },
        { type: "Theme", id: "ACTIVE" },
      ],
    }),
    activateTheme: b.mutation({
      query: (id) => ({ url: `/theme/${id}/activate`, method: "POST" }),
      invalidatesTags: [
        { type: "Theme", id: "LIST" },
        { type: "Theme", id: "ACTIVE" },
      ],
    }),
    deleteTheme: b.mutation({
      query: (id) => ({ url: `/theme/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Theme", id: "LIST" }],
    }),
    seedPresets: b.mutation({
      query: () => ({ url: "/theme/seed-presets", method: "POST" }),
      invalidatesTags: [{ type: "Theme", id: "LIST" }],
    }),
  }),
});

export const {
  useGetActiveThemeQuery,
  useListThemesQuery,
  useGetThemeQuery,
  useCreateThemeMutation,
  useUpdateThemeMutation,
  useActivateThemeMutation,
  useDeleteThemeMutation,
  useSeedPresetsMutation,
} = themeApi;
