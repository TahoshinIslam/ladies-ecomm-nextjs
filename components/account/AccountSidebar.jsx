"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, User as UserIcon, MapPin, Lock } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";

const ITEMS = [
  { href: "/dashboard", icon: LayoutDashboard, labelKey: "navigation.dashboard" },
  { href: "/profile", icon: UserIcon, labelKey: "account.navProfile" },
  { href: "/profile/addresses", icon: MapPin, labelKey: "account.navAddresses" },
  { href: "/profile/password", icon: Lock, labelKey: "account.navPassword" },
];

/**
 * Persistent left nav for the whole "my account" area (Dashboard, Profile
 * info, Addresses, Password) — shared via app/(routes)/(account)/layout.jsx
 * so it stays mounted across those routes instead of each page redeclaring
 * its own tab bar (previously only views/ProfilePage.jsx had one, scoped to
 * just its own 3 tabs, with Dashboard sitting outside it entirely).
 */
export default function AccountSidebar() {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav aria-label={t("account.heading")} className="flex gap-1 overflow-x-auto lg:flex-col">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent/10 text-accent"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 flex-none" />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
