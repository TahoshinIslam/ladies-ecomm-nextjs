"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";

import { selectAuthHydrated, selectCanAccessAdmin, selectCurrentUser } from "../../store/authSlice.js";
import { hasPermission } from "../../lib/permissions.js";
import { storage } from "../../lib/utils.js";
import { useAdminEventStream } from "../../hooks/useAdminEventStream.js";
import { filterAdminNav, findRequiredPermission } from "./adminNav.js";
import AdminSidebar from "./AdminSidebar.jsx";
import MobileSidebar from "./MobileSidebar.jsx";
import AdminTopbar from "./AdminTopbar.jsx";
import AdminFooter from "./AdminFooter.jsx";
import AdminErrorState from "./AdminErrorState.jsx";

const COLLAPSE_KEY = "tahos:adminSidebarCollapsed";

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
 * This app has no NextAuth/server session — auth is a Redux-held bearer
 * token hydrated from localStorage (see store/authSlice.js's
 * hydrateAuth()), so the gates below are unchanged from before this
 * refactor: they're what actually keeps someone off a page they can't
 * use. A hidden sidebar link never was, and still isn't, a security
 * boundary — findRequiredPermission()'s page-level check below is.
 */
export default function AdminLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Only ever read/written after the auth gates below have already decided
  // to render the real shell (never during the loading/redirect branches),
  // so this can't disagree with server-rendered markup — there isn't any
  // for this branch. See adjacent components for the same reasoning.
  const [collapsed, setCollapsed] = useState(() => storage.get(COLLAPSE_KEY) === "1");
  const mobileNavTriggerRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const user = useSelector(selectCurrentUser);
  const hydrated = useSelector(selectAuthHydrated);
  const canAccessAdmin = useSelector(selectCanAccessAdmin);
  const navItems = filterAdminNav(user);
  const shouldReduceMotion = useReducedMotion();
  useAdminEventStream();

  // Redirect only after the localStorage session check has actually run —
  // `hydrated` is what tells "genuinely logged out" apart from "haven't
  // checked yet," so a real admin never gets bounced on a hard refresh.
  useEffect(() => {
    if (hydrated && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [hydrated, user, router, pathname]);

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
    setCollapsed((prev) => {
      const next = !prev;
      storage.set(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  // Still reading localStorage — render nothing conclusive either way yet.
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No session — the effect above is already redirecting; render nothing
  // in the meantime rather than a half-built shell.
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
      <AdminSidebar items={navItems} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        items={navItems}
        triggerRef={mobileNavTriggerRef}
      />

      {/* Content column — min-w-0 is load-bearing: without it, a wide table
          or an unbreakable string in `children` forces this flex item (and
          the whole shell) wider than the viewport instead of scrolling
          inside its own container. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AdminTopbar onOpenMobileNav={() => setMobileOpen(true)} mobileNavTriggerRef={mobileNavTriggerRef} />

        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
        >
          {children}
        </motion.main>

        <AdminFooter />
      </div>
    </div>
  );
}
