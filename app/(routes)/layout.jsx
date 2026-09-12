import StorefrontShell from "@/components/layout/StorefrontShell.jsx";
import { getCachedCategories } from "@/lib/serverDataCache.js";
import { getServerLocale } from "@/lib/i18n/server.js";
import { localizeCategoryList } from "@/lib/i18n/localize.js";

// Every route under this layout is already request-time dynamic
// (proxy.js's middleware reads the session cookie for all of them), so
// this changes no runtime behavior — but WITHOUT it, `next build`'s
// static-generation workers execute this layout to probe whether the
// route COULD be static, which really did call getCachedCategories() (a
// real connectDB() against MONGO_URI, this project's Production
// database) during every single `npm run build`. Same fix, same reason,
// as app/sitemap.js's own `force-dynamic` export.
export const dynamic = "force-dynamic";

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
