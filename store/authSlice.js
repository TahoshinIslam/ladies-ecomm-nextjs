import { createSlice } from "@reduxjs/toolkit";

// Phase 2: no token, ever — the session lives entirely in the HttpOnly
// __Host-tahos_session cookie (server-only, never readable from JS). Redux
// holds only sanitized user info and a boot-resolution status; nothing
// here is a credential, so nothing here needs to survive in localStorage
// for a page reload to work — hooks/useAuthBoot.js re-derives it from the
// cookie via GET /api/users/me on every boot instead.
const initialState = {
  user: null,
  // "loading" until useAuthBoot's GET /api/users/me resolves one way or
  // the other. A guard like AdminLayout can't tell "genuinely logged out"
  // from "haven't checked yet" without this distinct third state — both
  // looked like `user: null` before, and redirecting on the latter would
  // kick out an already-logged-in admin on every hard refresh.
  status: "loading",
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    // Always a bare, sanitized user object — never `{ user, token }`. There
    // is no token to carry anymore.
    setCredentials: (state, { payload }) => {
      state.user = payload;
      state.status = "authenticated";
    },
    clearCredentials: (state) => {
      state.user = null;
      state.status = "unauthenticated";
    },
  },
});

export const { setCredentials, clearCredentials } = authSlice.actions;
export default authSlice.reducer;

// Selectors
export const selectAuthStatus = (state) => state.auth.status;
// Kept for existing consumers (AdminLayout.jsx etc.) — "hydrated" now means
// "boot has resolved one way or the other," not "localStorage was read."
export const selectAuthHydrated = (state) => state.auth.status !== "loading";
export const selectCurrentUser = (state) => state.auth.user;
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
