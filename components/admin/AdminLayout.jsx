"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Tag,
  Palette,
  Settings,
  Menu,
  X,
  Home,
  ChevronRight,
  Star,
  Folder,
} from "lucide-react";

import { cn } from "../../lib/utils.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import NotificationsDropdown from "./NotificationsDropdown.jsx";

// Each item declares the permission it requires. `adminOnly: true` means
// only the admin role can see it (employees with no equivalent permission).
const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true, perm: "readAnalytics" },
  { to: "/admin/products", label: "Products", icon: Package, perm: "manageProducts" },
  { to: "/admin/orders", label: "Orders", icon: ShoppingCart, perm: "readOrders" },
  { to: "/admin/users", label: "Users", icon: Users, adminOnly: true },
  { to: "/admin/categories", label: "Categories", icon: Folder, perm: "manageCategories" },
  { to: "/admin/coupons", label: "Coupons", icon: Tag, perm: "manageCoupons" },
  { to: "/admin/reviews", label: "Reviews", icon: Star, perm: "readReviews" },
  { to: "/admin/themes", label: "Themes", icon: Palette, highlight: true, perm: "manageThemes" },
  { to: "/admin/settings", label: "Settings", icon: Settings, perm: "manageSettings" },
];

const filterNav = (user) => {
  if (!user) return [];
  if (user.role === "admin") return NAV;
  if (user.role === "employee") {
    const perms = user.permissions || [];
    return NAV.filter(
      (item) => !item.adminOnly && item.perm && perms.includes(item.perm),
    );
  }
  return [];
};

export default function AdminLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const user = useSelector(selectCurrentUser);
  const navItems = filterNav(user);

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 border-r border-border bg-background lg:block">
        <SidebarContent items={navItems} />
      </aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-background lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-border p-4">
                <span className="font-heading font-bold">Admin</span>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="rounded p-1 hover:bg-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarContent items={navItems} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {/* Top bar */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded p-1 hover:bg-muted lg:hidden"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1 lg:hidden">
            <Breadcrumb />
          </div>
          <div className="ml-auto">
            <NotificationsDropdown />
          </div>
        </div>

        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="p-4 sm:p-6 lg:p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

function SidebarContent({ items, onNavigate }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Admin Panel
        </p>
        <h2 className="mt-1 font-heading text-xl font-black">
          Dashboard<span className="text-accent">.</span>
        </h2>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              href={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-accent/10 text-accent shadow-soft"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  item.highlight && !isActive && "text-accent/80"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {item.highlight && (
                <span className="ml-auto inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </Link>
          );
        })}
      </nav>

      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-3 border-t border-border p-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Home className="h-4 w-4" />
        Back to store
      </Link>
    </div>
  );
}

function Breadcrumb() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const current = parts[parts.length - 1] || "overview";
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>Admin</span>
      <ChevronRight className="h-3 w-3" />
      <span className="font-semibold capitalize text-foreground">{current}</span>
    </div>
  );
}
