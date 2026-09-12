"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { motion, useReducedMotion } from "framer-motion";
import { LayoutDashboard } from "lucide-react";

import { selectAuthHydrated, selectCurrentUser } from "../../store/authSlice.js";
import { hasPermission } from "../../lib/permissions.js";
import { storage } from "../../lib/utils.js";
import { useAdminEventStream } from "../../hooks/useAdminEventStream.js";
import { filterAdminNav, findRequiredPermission, matchNavItem } from "./adminNav.js";
import AdminSidebar from "./AdminSidebar.jsx";
import MobileSidebar from "./MobileSidebar.jsx";
import AdminTopbar from "./AdminTopbar.jsx";
import AdminFooter from "./AdminFooter.jsx";
import AdminErrorState from "./AdminErrorState.jsx";
import Breadcrumb from "../ui/Breadcrumb.jsx";

const COLLAPSE_KEY = "tahos:adminSidebarCollapsed";

// Nothing external ever changes this key besides this same component's own
// toggleCollapsed() below, so there's no real event to subscribe to — but
// useSyncExternalStore still needs a subscribe function, and using it (with
// a false getServerSnapshot) is what lets the persisted value apply on the
// client's first paint without a hydration mismatch: React specifically
// reconciles a getServerSnapshot/getSnapshot difference here, instead of
// this needing a setState-in-effect (which a repeat, non-SSR-safe render
// pass would otherwise require).
const noopSubscribe = () => () => {};
const getPersistedCollapsed = () => storage.get(COLLAPSE_KEY) === "1";
const getServerCollapsed = () => false;

/**
 * The admin application shell: auth/permission gates, then a flex row of
 * [sidebar][content column]. The content column is its own flex-col
 * (topbar, main, footer) so the footer sits in normal flow and lands at
 * the bottom of short pages without any absolute positioning — the classic
 * sticky-footer pattern (`main` carries `flex-1`, everything else is
 * `flex-none`). `min-w-0` on the content column is what stops a wide table
 * or long unbreakable string from forcing the whole shell to overflow
 * horizontally; the sidebar's own width is fixed and never contributes to
 * that overflow.
 *
 * Phase 2: auth is a real server-side session behind an HttpOnly cookie —
 * Redux only mirrors the sanitized user object GET /api/users/me returns
 * (see hooks/useAuthBoot.js), it never holds a credential. The gates below
 * are still what actually keeps someone off a page they can't use, exactly
 * as before this migration: they're a UX convenience, not the real
 * boundary. A hidden sidebar link never was, and still isn't, a security
 * boundary — findRequiredPermission()'s page-level check below isn't
 * either, for that matter; the real boundary is every Route Handler's own
 * requireUser()/requireAdmin()/requirePermission() call, enforced
 * server-side regardless of what this component renders.
 *
 * `initialUser` (from app/admin/layout.jsx, a Server Component that already
 * ran the real requireServerUser() check one render pass earlier) is what
 * this component uses BEFORE Redux's own independent client-side boot
 * (hooks/useAuthBoot.js's GET /api/users/me) resolves. Previously this
 * whole shell — sidebar, topbar, and every admin page's real content
 * underneath it, including Overview's already-server-rendered charts —
 * waited on that second, redundant round trip before rendering anything
 * but a loading placeholder, even though the server had already answered
 * the exact same question. Once Redux hydrates it takes over as the live
 * source of truth (so a session that actually expires mid-visit still gets
 * caught); until then, `initialUser` lets the real shell render on the
 * very first paint — server-side included, which is what actually lets
 * Next.js stream real content instead of a client-only shell.
 */
export default function AdminLayout({ children, initialUser = null }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Deliberately not a plain `useState(() => storage.get(...))` (that was
  // only SSR-safe before because AdminSidebar never actually rendered
  // server-side — see this component's own doc comment, that's no longer
  // true): a value read from storage in that initializer would make the
  // server-rendered `collapsed` (storage.get() is SSR-guarded to return
  // null there) disagree with a repeat visitor's real, persisted value on
  // the client — a genuine hydration mismatch. useSyncExternalStore is the
  // React-supported way to apply a client-only persisted value without one.
  const persistedCollapsed = useSyncExternalStore(noopSubscribe, getPersistedCollapsed, getServerCollapsed);
  const [collapsedOverride, setCollapsedOverride] = useState(null);
  const collapsed = collapsedOverride ?? persistedCollapsed;
  const mobileNavTriggerRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const reduxUser = useSelector(selectCurrentUser);
  const hydrated = useSelector(selectAuthHydrated);
  // Redux's own state starts identical on the server and on the client's
  // first (pre-hydration-effect) paint — {user: null, status: "loading"} —
  // so `hydrated` is false in both places until useAuthBoot's effect
  // actually resolves. That means this expression yields the exact same
  // value server- and client-side on first paint (initialUser), which is
  // what makes rendering the real shell from it SSR-safe.
  const user = hydrated ? reduxUser : initialUser;
  const canAccessAdmin = !!user && ["admin", "employee"].includes(user.role);
  const navItems = filterAdminNav(user);
  // Rendered above {children} below, not in AdminTopbar's persistent
  // header — see AdminTopbar.jsx's own comment for why that moved.
  const currentNavItem = matchNavItem(pathname);
  const breadcrumbItems = [
    { label: "Admin", href: "/admin", icon: LayoutDashboard },
    ...(currentNavItem && currentNavItem.to !== "/admin" ? [{ label: currentNavItem.label }] : []),
  ];
  const shouldReduceMotion = useReducedMotion();
  useAdminEventStream();

  // Redirect only once Redux's OWN boot has resolved unauthenticated —
  // `initialUser` already answers this while that's still in flight, so
  // there's nothing to redirect on until hydrated genuinely disagrees
  // (e.g. a session that expired since the server render).
  useEffect(() => {
    if (hydrated && !reduxUser) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [hydrated, reduxUser, router, pathname]);

  // Close the mobile drawer on route change (e.g. browser back/forward,
  // not just an in-drawer link click, which already closes it itself) —
  // set during render, React's documented "adjust state when a prop
  // changes" pattern (same idiom Header.jsx uses for its own
  // pathname-driven reset), so it can't cause an extra render pass the way
  // doing this in an effect would.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const toggleCollapsed = () => {
    const next = !collapsed;
    storage.set(COLLAPSE_KEY, next ? "1" : "0");
    setCollapsedOverride(next);
  };

  // No session from EITHER source — shouldn't normally happen (the parent
  // Server Component layout already redirected unauthenticated visitors
  // before this ever mounted), but the redirect effect above still handles
  // a session that expires mid-visit; render nothing in the meantime
  // rather than a half-built shell.
  if (!user) return null;

  // A real, logged-in session that just isn't admin/employee. Distinct from
  // "no session" — this person is authenticated, they simply don't have
  // access, so no redirect: tell them plainly instead.
  if (!canAccessAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 p-6">
        <div className="w-full max-w-sm">
          <AdminErrorState
            title="Access denied"
            message="Your account doesn't have permission to view the admin panel."
            actionLabel="Back to store"
            actionHref="/"
          />
        </div>
      </div>
    );
  }

  // Admin/employee, but this specific page needs a permission they don't
  // have. This is what actually stops direct-URL access — the sidebar only
  // ever hides a link, it was never what kept someone off the page itself.
  const requiredPermission = findRequiredPermission(pathname);
  if (requiredPermission && !hasPermission(user, requiredPermission)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 p-6">
        <div className="w-full max-w-sm">
          <AdminErrorState
            title="Access denied"
            message="You don't have permission to view this section."
            actionLabel="Back to dashboard"
            actionHref="/admin"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/20">
      <AdminSidebar items={navItems} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} user={user} />
      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        items={navItems}
        triggerRef={mobileNavTriggerRef}
        user={user}
      />

      {/* Content column — min-w-0 is load-bearing: without it, a wide table
          or an unbreakable string in `children` forces this flex item (and
          the whole shell) wider than the viewport instead of scrolling
          inside its own container. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AdminTopbar onOpenMobileNav={() => setMobileOpen(true)} mobileNavTriggerRef={mobileNavTriggerRef} user={user} />

        <motion.main
          id="main"
          key={pathname}
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
        >
          <Breadcrumb items={breadcrumbItems} />
          {children}
        </motion.main>

        <AdminFooter />
      </div>
    </div>
  );
}
