"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, Home, LogOut } from "lucide-react";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "sonner";

import { cn } from "../../lib/utils.js";
import { selectCurrentUser, clearCredentials } from "../../store/authSlice.js";
import { useLogoutMutation } from "../../store/userApi.js";
import { isNavItemActive } from "./adminNav.js";

const PILL_ID = "admin-sidebar-active-pill";
const BAR_ID = "admin-sidebar-active-bar";

/**
 * Desktop sidebar — expanded (256px) or collapsed to an icon rail (76px),
 * with a shared-layout active pill/bar that slides between items instead
 * of just swapping classes. Collapse state persists across sessions the
 * same way every other per-visitor preference in this app does (currency,
 * theme): a plain localStorage flag via lib/utils.js's SSR-safe `storage`
 * helper — this component never renders during SSR (AdminLayout gates the
 * whole panel behind a client-only auth check first), so reading it
 * synchronously in the initial useState can't cause a hydration mismatch.
 */
export default function AdminSidebar({ items, collapsed, onToggleCollapsed }) {
  const pathname = usePathname();
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const router = useRouter();
  const [logout] = useLogoutMutation();
  const shouldReduceMotion = useReducedMotion();

  const handleLogout = async () => {
    try {
      await logout().unwrap();
    } catch {
      // Server-side session may already be gone; clear locally regardless.
    }
    dispatch(clearCredentials());
    toast.success("Signed out");
    router.push("/");
  };

  const pillTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 420, damping: 34 };

  return (
    <aside
      aria-label="Admin navigation"
      className={cn(
        "sticky top-0 hidden h-screen flex-none flex-col border-r border-border bg-background transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={cn("flex h-16 flex-none items-center border-b border-border", collapsed ? "justify-center px-2" : "justify-between px-5")}>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Admin Panel</p>
            <h2 className="truncate font-heading text-lg font-black leading-tight">
              Dashboard<span className="text-accent">.</span>
            </h2>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <SidebarNavItem
            key={item.to}
            item={item}
            active={isNavItemActive(item, pathname)}
            collapsed={collapsed}
            pillTransition={pillTransition}
          />
        ))}
      </nav>

      {/* Account + logout */}
      <div className={cn("flex-none border-t border-border p-3", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-3 rounded-lg px-2 py-2", collapsed && "justify-center px-0")}>
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-muted text-xs font-bold uppercase text-foreground">
            {user?.name?.[0] || "?"}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          )}
        </div>
        <Link
          href="/"
          title={collapsed ? "Back to store" : undefined}
          className={cn(
            "mt-1 flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <Home className="h-4 w-4 flex-none" />
          {!collapsed && "Back to store"}
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <LogOut className="h-4 w-4 flex-none" />
          {!collapsed && "Sign out"}
        </button>
      </div>
    </aside>
  );
}

/**
 * One nav row. The collapsed-mode tooltip is portaled to `document.body`
 * and positioned with `position: fixed` from the link's own
 * getBoundingClientRect() — not CSS `absolute` + `group-hover`, which was
 * the first approach here and silently never appeared: the nav list needs
 * `overflow-y-auto` (scrollable when taller than the viewport), and per
 * the CSS spec, setting only one axis's overflow away from `visible`
 * forces the other axis to `auto` too, so an absolutely-positioned
 * tooltip escaping to the right was being clipped by that same
 * scroll container. `position: fixed` in a portal escapes it entirely.
 */
function SidebarNavItem({ item, active, collapsed, pillTransition }) {
  const Icon = item.icon;
  const linkRef = useRef(null);
  const [tooltipPos, setTooltipPos] = useState(null);

  const showTooltip = () => {
    if (!collapsed || !linkRef.current) return;
    const rect = linkRef.current.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideTooltip = () => setTooltipPos(null);

  return (
    <>
      <Link
        ref={linkRef}
        href={item.to}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          collapsed && "justify-center px-0",
          active ? "text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {active && (
          <motion.span
            layoutId={PILL_ID}
            transition={pillTransition}
            className="absolute inset-0 rounded-lg bg-accent/10"
          />
        )}
        {active && (
          <motion.span
            layoutId={BAR_ID}
            transition={pillTransition}
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent"
          />
        )}
        <Icon className={cn("relative h-4 w-4 flex-none transition-transform duration-150", active && "scale-110")} />
        {!collapsed && <span className="relative truncate">{item.label}</span>}
        {!collapsed && item.highlight && (
          <span className="relative ml-auto inline-flex h-1.5 w-1.5 flex-none rounded-full bg-accent" />
        )}
      </Link>

      {/* Hover/focus only — never the sole way to identify a collapsed
          item, since the icon plus the link's own `title` attribute above
          already do that; this is a visual convenience on top. */}
      {collapsed &&
        tooltipPos &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
            className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-elev px-2.5 py-1.5 text-xs font-medium text-foreground shadow-soft"
          >
            {item.label}
          </span>,
          document.body,
        )}
    </>
  );
}
