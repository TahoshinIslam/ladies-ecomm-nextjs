import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Tag,
  Palette,
  Settings,
  Star,
  Folder,
  SlidersHorizontal,
} from "lucide-react";

import { PERMISSIONS, hasPermission } from "../../lib/permissions.js";

// Single source of truth for the admin nav — backs the desktop sidebar, the
// mobile drawer, the topbar breadcrumb, AND the direct-URL permission gate
// in AdminLayout.jsx. One list instead of the desktop/mobile duplicating
// their own copies (a real risk the old sidebar avoided by luck, not
// design — this makes it structural). Each item's `perm` is the minimum
// permission needed to reach that page at all — for Products/Orders that's
// the .view tier (an employee with only products.view can see the list;
// products.manage is checked separately, inline on the page, before
// create/edit/delete).
export const ADMIN_NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true, perm: PERMISSIONS.DASHBOARD_VIEW },
  { to: "/admin/products", label: "Products", icon: Package, perm: PERMISSIONS.PRODUCTS_VIEW },
  { to: "/admin/product-config", label: "Product Config", icon: SlidersHorizontal, perm: PERMISSIONS.CATEGORIES_MANAGE },
  { to: "/admin/orders", label: "Orders", icon: ShoppingCart, perm: PERMISSIONS.ORDERS_VIEW },
  { to: "/admin/users", label: "Users", icon: Users, perm: PERMISSIONS.USERS_MANAGE },
  { to: "/admin/categories", label: "Categories", icon: Folder, perm: PERMISSIONS.CATEGORIES_MANAGE },
  { to: "/admin/coupons", label: "Coupons", icon: Tag, perm: PERMISSIONS.COUPONS_MANAGE },
  { to: "/admin/reviews", label: "Reviews", icon: Star, perm: PERMISSIONS.REVIEWS_MANAGE },
  { to: "/admin/themes", label: "Themes", icon: Palette, highlight: true, perm: PERMISSIONS.THEMES_MANAGE },
  { to: "/admin/settings", label: "Settings", icon: Settings, perm: PERMISSIONS.SETTINGS_MANAGE },
];

// Exact route matches; nested routes (e.g. a future /admin/orders/[id])
// keep their parent active via startsWith(to + "/") — never a bare
// substring match, so "/admin/order" (a typo, or an unrelated future
// route) can never accidentally activate "/admin/orders".
export const isNavItemActive = (item, pathname) =>
  item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

// The current page's required permission, if it matches a catalogued admin
// route. No match (a page not yet added to ADMIN_NAV) falls through to
// "allowed" — the broad admin/employee gate already covers it; this only
// adds the finer-grained per-module check on top.
export const findRequiredPermission = (pathname) =>
  ADMIN_NAV.find((item) => isNavItemActive(item, pathname))?.perm;

export const filterAdminNav = (user) => ADMIN_NAV.filter((item) => hasPermission(user, item.perm));

// For the topbar breadcrumb / page title — the catalogued item matching the
// current path, if any.
export const matchNavItem = (pathname) => ADMIN_NAV.find((item) => isNavItemActive(item, pathname));
