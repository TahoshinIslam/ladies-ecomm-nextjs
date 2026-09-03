"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Home, LogOut, X } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";

import { cn } from "../../lib/utils.js";
import { selectCurrentUser, clearCredentials } from "../../store/authSlice.js";
import { useLogoutMutation } from "../../store/userApi.js";
import { isNavItemActive } from "./adminNav.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mobile/tablet nav drawer — same accessible-dialog pattern already used by
 * components/ui/Modal.jsx and views/ShopPage.jsx's FilterSheetMobile: a
 * focus trap, Escape to close, background scroll lock, and focus restored
 * to whatever opened it. Unmounts entirely below `lg` via the parent's
 * conditional render, so it never fights the desktop sidebar for the same
 * space or tab order.
 */
export default function MobileSidebar({ open, onClose, items, triggerRef }) {
  const panelRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const [logout] = useLogoutMutation();

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement;
    const trigger = triggerRef?.current;
    // Focus the panel first so a screen reader announces the dialog before
    // landing on its first interactive item.
    panel?.focus();

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll(FOCUSABLE));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      // Restore focus to the trigger that opened the drawer, not whatever
      // `previouslyFocused` was — Escape/backdrop-close and a nav click both
      // route through this same cleanup, and after a nav click the trigger
      // is the only stable, still-mounted target worth returning to.
      (trigger || previouslyFocused)?.focus?.();
    };
  }, [open, onClose, triggerRef]);

  const handleLogout = async () => {
    onClose();
    try {
      await logout().unwrap();
    } catch {
      // Server-side session may already be gone; clear locally regardless.
    }
    dispatch(clearCredentials());
    toast.success("Signed out");
    router.push("/");
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            tabIndex={-1}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="absolute inset-y-0 left-0 flex w-[min(300px,84%)] flex-col border-r border-border bg-background outline-none"
          >
            <div className="flex h-16 flex-none items-center justify-between border-b border-border px-5">
              <h2 className="font-heading text-lg font-black">
                Admin<span className="text-accent">.</span>
              </h2>
              <button
                onClick={onClose}
                aria-label="Close navigation"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item, pathname);
                return (
                  <Link
                    key={item.to}
                    href={item.to}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors focus-ring",
                      active ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
                    )}
                    <Icon className="h-4 w-4 flex-none" />
                    <span className="truncate">{item.label}</span>
                    {item.highlight && (
                      <span aria-hidden="true" className="ml-auto inline-flex h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="flex-none border-t border-border p-3">
              <div className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-muted text-xs font-bold uppercase text-foreground">
                  {user?.name?.[0] || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <Link
                href="/"
                onClick={onClose}
                className="mt-1 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
              >
                <Home className="h-4 w-4 flex-none" />
                Back to store
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-ring"
              >
                <LogOut className="h-4 w-4 flex-none" />
                Sign out
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
