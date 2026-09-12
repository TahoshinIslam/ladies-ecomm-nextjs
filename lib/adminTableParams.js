// Server-side mirror of hooks/useTableQueryState.js's URL-parsing rules.
// An admin list Server Component uses this to turn the same URL
// (Next.js's `searchParams`, already awaited to a plain
// `{key: string | string[]}` object) into the exact same
// {page, limit, search, sortBy, sortOrder, ...filters} shape the client's
// own useTableQueryState() + RTK Query hook will compute for that same
// URL. Keeping both sides byte-identical (after JSON.stringify) is what
// lets hooks/useHydratedQuery.js's cache-seeding actually match on args —
// a mismatch here would silently reintroduce the duplicate-initial-fetch
// problem this whole mechanism exists to prevent. Change one, change both.
export function parseAdminTableParams(
  rawSearchParams,
  { defaultLimit = 20, defaultSortBy = "", defaultSortOrder = "desc", filterKeys = [] } = {},
) {
  const get = (key) => {
    const v = rawSearchParams?.[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const page = Math.max(1, Number(get("page")) || 1);
  const limit = Number(get("limit")) || defaultLimit;
  const search = get("search") || "";
  const sortBy = get("sortBy") || defaultSortBy;
  const sortOrder = get("sortOrder") || defaultSortOrder;

  const filters = {};
  for (const key of filterKeys) {
    const v = get(key);
    if (v) filters[key] = v;
  }

  return { page, limit, search, sortBy, sortOrder, filters };
}
