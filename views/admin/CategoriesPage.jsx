import CategoriesPageClient from "./CategoriesPageClient.jsx";
import { getCachedCategories, getCachedAllAttributes } from "../../lib/serverDataCache.js";
import { requireServerPermission } from "../../lib/serverPageAuth.js";
import { serializeForClient } from "../../lib/serialize.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Real Server Component — same shape as views/admin/OrdersPage.jsx/
// UsersPage.jsx. Both getCachedCategories()/getCachedAllAttributes() are
// the exact same cached reads app/api/categories/route.js and
// app/api/attributes/route.js already serve (never re-localized here —
// admin always gets the raw bilingual data, matching those routes' own
// "admin never gets the localized copy" rule), fetched directly rather
// than via a self-HTTP round trip, and handed to the client as a
// hydration seed for its own RTK Query cache.
export default async function AdminCategoriesPage() {
  await requireServerPermission(PERMISSIONS.CATEGORIES_MANAGE, "/admin/categories");

  const [rawCategories, rawAttributes] = await Promise.all([getCachedCategories(), getCachedAllAttributes()]);

  return (
    <CategoriesPageClient
      initialCategories={serializeForClient({ categories: rawCategories })}
      initialAttributes={serializeForClient({ attributes: rawAttributes })}
    />
  );
}
