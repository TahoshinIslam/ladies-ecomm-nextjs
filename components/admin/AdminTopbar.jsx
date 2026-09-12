"use client";

import { useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import { LogOut, Menu, Moon, Sun, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

import DropdownMenu, { DropdownMenuItem } from "../ui/DropdownMenu.jsx";
import NotificationsDropdown from "./NotificationsDropdown.jsx";
import LanguageSwitcher from "../layout/LanguageSwitcher.jsx";
import { useTheme } from "../../context/ThemeProvider.jsx";
import { clearCredentials } from "../../store/authSlice.js";
import { useLogoutMutation } from "../../store/userApi.js";

/**
 * Sticky topbar: mobile menu trigger, theme switcher, notifications
 * (unchanged, real data), and a user menu. Height stays fixed (h-16,
 * matching the sidebar's brand row so they align) regardless of what's
 * visible at a given breakpoint — buttons hide, the bar itself never grows.
 *
 * The "Admin > current page" breadcrumb used to live here, but a persistent
 * header is the wrong place for it — it read as floating, disconnected
 * chrome above the page rather than part of the page. It now renders in
 * AdminLayout.jsx, directly above each page's own heading (e.g. right above
 * "Products" / "3 products total"), the same relationship every storefront
 * page's own breadcrumb already has to its heading.
 */
export default function AdminTopbar({ onOpenMobileNav, mobileNavTriggerRef, user }) {
  const router = useRouter();
  const dispatch = useDispatch();
  const { isDark, toggleTheme } = useTheme();
  const [logout] = useLogoutMutation();

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

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-none items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        ref={mobileNavTriggerRef}
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
        className="grid h-10 w-10 flex-none place-items-center rounded-lg text-foreground transition-colors hover:bg-muted focus-ring lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer — pushes the icon cluster to the right now that the
          breadcrumb (moved to AdminLayout.jsx, above each page's heading)
          no longer occupies this space. */}
      <div className="min-w-0 flex-1" />

      <div className="flex flex-none items-center gap-1">
        <LanguageSwitcher
          showLabel="never"
          className="h-10 w-10 justify-center rounded-lg px-0 text-foreground hover:bg-muted"
        />

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          title={isDark ? "Light theme" : "Dark theme"}
          className="grid h-10 w-10 place-items-center rounded-lg text-foreground transition-colors hover:bg-muted focus-ring"
        >
          {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        <NotificationsDropdown />

        <DropdownMenu
          triggerLabel="Account menu"
          trigger={
            <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-bold uppercase text-foreground">
              {user?.name?.[0] || "?"}
            </span>
          }
        >
          <div className="border-b border-border px-3 pb-2.5 pt-2">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <DropdownMenuItem icon={UserIcon} onClick={() => router.push("/profile")}>
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem icon={LogOut} danger onClick={handleLogout}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
