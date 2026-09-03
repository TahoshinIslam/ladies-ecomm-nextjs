// Single source of truth for every permission string in the app — used by
// the backend guard (lib/auth.js's requirePermission), the frontend hook
// (hooks/usePermission.js), and the admin UI's assignable-permission list
// (views/admin/UsersPage.jsx). No separate Role/Permission database models;
// this deliberately stays a flat list matching the existing
// user.role/user.permissions fields on models/userModel.js.
export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_MANAGE: "products.manage",
  CATEGORIES_MANAGE: "categories.manage",
  ORDERS_VIEW: "orders.view",
  ORDERS_MANAGE: "orders.manage",
  USERS_MANAGE: "users.manage",
  COUPONS_MANAGE: "coupons.manage",
  REVIEWS_MANAGE: "reviews.manage",
  THEMES_MANAGE: "themes.manage",
  SETTINGS_MANAGE: "settings.manage",
};

// Modules with both a .view and a .manage tier: holding the .manage
// permission implies the .view one too — managing something necessarily
// requires being able to see it, and nobody should need both checkboxes
// ticked to reach a page they can already fully operate.
const MANAGE_IMPLIES_VIEW = {
  [PERMISSIONS.PRODUCTS_VIEW]: PERMISSIONS.PRODUCTS_MANAGE,
  [PERMISSIONS.ORDERS_VIEW]: PERMISSIONS.ORDERS_MANAGE,
};

/**
 * The one permission check used everywhere — admin/employee route guards,
 * the admin layout's page gate, and per-button UI gating all call this same
 * function so there is exactly one place the actual rule lives.
 */
export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "employee") return false;

  const perms = user.permissions || [];
  if (perms.includes(permission)) return true;

  const managePermission = MANAGE_IMPLIES_VIEW[permission];
  return !!managePermission && perms.includes(managePermission);
}
