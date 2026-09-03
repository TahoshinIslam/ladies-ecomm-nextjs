import { createSlice } from "@reduxjs/toolkit";

import { storage } from "../lib/utils.js";

// Minimal auth state. The JWT is stored in localStorage and sent as a Bearer
// token in the Authorization header by apiSlice.
const USER_KEY = "ss:user";
const TOKEN_KEY = "ss:token";

// Empty on the server; the persisted session is applied by hydrateAuth once
// the client has mounted, which keeps the two first renders identical.
const initialState = {
  user: null,
  token: null,
  // False until hydrateAuth has run once on the client. A guard like
  // AdminLayout can't tell "genuinely logged out" from "haven't checked
  // localStorage yet" without this — both look like `user: null` otherwise,
  // and redirecting on the latter would kick out an already-logged-in admin
  // on every hard refresh.
  hydrated: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    hydrateAuth: (state) => {
      state.user = storage.getJSON(USER_KEY, null);
      state.token = storage.get(TOKEN_KEY);
      state.hydrated = true;
    },
    // Accepts either { user, token } (login/register) or a bare user object
    // (refresh from /me, profile update — token unchanged).
    setCredentials: (state, { payload }) => {
      if (payload && payload.user !== undefined) {
        state.user = payload.user;
        storage.setJSON(USER_KEY, payload.user);
        if (payload.token) {
          state.token = payload.token;
          storage.set(TOKEN_KEY, payload.token);
        }
      } else {
        state.user = payload;
        storage.setJSON(USER_KEY, payload);
      }
    },
    clearCredentials: (state) => {
      state.user = null;
      state.token = null;
      storage.remove(USER_KEY);
      storage.remove(TOKEN_KEY);
    },
  },
});

export const { hydrateAuth, setCredentials, clearCredentials } = authSlice.actions;
export default authSlice.reducer;

// Selectors
export const selectAuthHydrated = (state) => state.auth.hydrated;
export const selectCurrentUser = (state) => state.auth.user;
export const selectAuthToken = (state) => state.auth.token;
export const selectIsAuthenticated = (state) => !!state.auth.user;
export const selectIsAdmin = (state) => state.auth.user?.role === "admin";
export const selectCanAccessAdmin = (state) =>
  ["admin", "employee"].includes(state.auth.user?.role);
export const selectHasPermission = (permission) => (state) => {
  const user = state.auth.user;
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "employee" && user.permissions?.includes(permission))
    return true;
  return false;
};
