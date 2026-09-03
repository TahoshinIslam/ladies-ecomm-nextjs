"use client";

import { useMemo } from "react";

import ProductRail from "./ProductRail.jsx";
import { useRecentlyViewed } from "../../hooks/useRecentlyViewed.js";
import { useGetProductsByIdsQuery } from "../../store/productApi.js";
import { useLocale } from "../../context/LocaleProvider.jsx";

/**
 * Resolves the visitor's stored id list against real MongoDB data (never
 * displays the stale localStorage snapshot) and re-applies the visitor's
 * own most-recent-first order afterward — a Mongo $in query does not
 * preserve input order, and this is the one place that matters: the whole
 * point of the section is "most recent first."
 */
export default function RecentlyViewedRail({ excludeId, title, className }) {
  const { t } = useLocale();
  const ids = useRecentlyViewed(excludeId);
  const { data, isLoading, isFetching } = useGetProductsByIdsQuery(ids, { skip: ids.length === 0 });

  const products = useMemo(() => {
    if (!data?.products) return [];
    const byId = new Map(data.products.map((p) => [p._id, p]));
    // Ids that resolved to nothing (deleted/deactivated since viewing) are
    // simply absent from byId and drop out here — no gaps, no crash.
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }, [data, ids]);

  // Nothing recorded yet (or storage hasn't hydrated this tick) — render
  // nothing rather than a skeleton for a section that may just never appear.
  if (ids.length === 0) return null;

  return (
    <div className={className}>
      <ProductRail
        id="recently-viewed-heading"
        title={title || t("recentlyViewed.heading")}
        products={products}
        isLoading={isLoading || (isFetching && products.length === 0)}
        skeletonCount={Math.min(ids.length, 4)}
      />
    </div>
  );
}
