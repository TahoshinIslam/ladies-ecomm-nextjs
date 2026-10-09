/**
 * The picture for each category on the storefront, by category slug.
 *
 * Two places can hold one: the dashboard's Shop layout → Home page → "Category images" (saved by category id, as `categoryImages`),
 * and the older per-slug map the storefront was first built around (`departmentImages`). The dashboard's pick wins; the old map fills
 * in whatever the dashboard has not set. Everything downstream keeps reading a slug → URL map.
 */
export function departmentImagesBySlug(homepage = {}, categories = []) {
  const bySlug = { ...(homepage.departmentImages || {}) };
  const byId = homepage.categoryImages || {};
  for (const category of categories) {
    const url = byId[String(category._id)];
    if (typeof url === "string" && url.trim()) bySlug[category.slug] = url.trim();
  }
  return bySlug;
}
