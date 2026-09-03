"use client";

import { useSelector } from "react-redux";

import { selectCurrentUser } from "../store/authSlice.js";
import { hasPermission } from "../lib/permissions.js";

/**
 * const can = usePermission();
 * can(PERMISSIONS.PRODUCTS_MANAGE)
 *
 * Same rule as the backend's requirePermission() — admin bypasses
 * everything, an employee needs the specific permission (or its .manage
 * counterpart, for the .view/.manage pairs) on their session.
 */
export function usePermission() {
  const user = useSelector(selectCurrentUser);
  return (permission) => hasPermission(user, permission);
}
