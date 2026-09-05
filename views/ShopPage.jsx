import ShopPageClient from "./shop/ShopPageClient.jsx";
import { listProducts, parseProductListQuery } from "../services/productService.js";
import { assertNoDuplicateQueryKeys, assertNoDangerousQueryKeys } from "../lib/validation.js";
import { parseQueryParams, HttpError } from "../lib/http.js";
import { serializeForClient } from "../lib/serialize.js";
import EmptyState from "../components/ui/EmptyState.jsx";
import { AlertCircle } from "lucide-react";

// Next.js searchParams (a plain `{key: string | string[]}` object) is
// reconstructed into a real URLSearchParams so this Server Component can
// reuse the EXACT same Phase 5 validated query contract GET /api/products
// itself uses (assertNoDuplicateQueryKeys/assertNoDangerousQueryKeys/
// parseQueryParams/parseProductListQuery) — one query contract, two entry
// points, never two implementations to keep in sync.
function toURLSearchParams(rawSearchParams) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams || {})) {
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else if (value !== undefined) {
      usp.append(key, value);
    }
  }
  return usp;
}

// Phase 7 — real, search-parameter-driven Server Component: the initial
// product list, total count, and facet counts are all fetched here via
// services/productService.js directly (no fetch back to this app's own
// /api). A malformed/invalid query (the same contract GET /api/products
// enforces) renders a safe, controlled empty state instead of crashing or
// leaking an internal error — never a literal thrown 500.
export default async function ShopPage({ searchParams }) {
  const rawSearchParams = await searchParams;
  const usp = toURLSearchParams(rawSearchParams);

  let result;
  let invalid = false;
  try {
    assertNoDuplicateQueryKeys(usp);
    assertNoDangerousQueryKeys(usp);
    const rawQuery = parseQueryParams(usp);
    const query = await parseProductListQuery(rawQuery);
    result = await listProducts(query, { isAdmin: false });
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      invalid = true;
    } else {
      throw err;
    }
  }

  if (invalid) {
    return (
      <div className="container-x py-20">
        <EmptyState
          icon={AlertCircle}
          title="Invalid filter"
          message="One of the filters in this link isn't valid. Try adjusting your search."
        />
      </div>
    );
  }

  const initialProducts = serializeForClient(result.products);
  const total = result.total;
  const facets = serializeForClient(result.facets);

  // Keying by the raw query string forces a full remount of the client
  // shell whenever the URL's filters change, so its local "show more"
  // pagination state always restarts from this fresh server-rendered
  // first page instead of carrying over stale state from the previous
  // filter selection.
  return (
    <ShopPageClient key={usp.toString()} initialProducts={initialProducts} total={total} facets={facets} />
  );
}
