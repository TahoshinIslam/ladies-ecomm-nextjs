import StorefrontShell from "@/components/layout/StorefrontShell.jsx";
import { getCachedCategories } from "@/lib/serverDataCache.js";
import { getServerLocale } from "@/lib/i18n/server.js";
import { localizeCategoryList } from "@/lib/i18n/localize.js";

/**
 * Real Server Component wrapper around the storefront chrome
 * (components/layout/StorefrontShell.jsx, "use client" — needs interactive
 * state: mega-menus, cart drawer, scroll listener, offline banner, ...).
 * Fetches the same cached, already-locale-resolved category list
 * app/api/categories/route.js serves (900s TTL — see
 * lib/serverDataCache.js's getCachedCategories()), so Header/Footer's
 * department nav links (Burqa/Hijab/Niqab/...) are present in the very
 * first server-rendered HTML instead of only appearing after their own
 * client-side useGetCategoriesQuery() fetch resolves (previously visible
 * on every page load as the nav rendering without them, then popping them
 * in a moment later).
 */
export default async function StorefrontLayout({ children }) {
  const [categories, locale] = await Promise.all([getCachedCategories(), getServerLocale()]);
  const initialDepartments = localizeCategoryList(categories, locale);

  return (
    <StorefrontShell initialDepartments={initialDepartments}>
      {children}
    </StorefrontShell>
  );
}
