"use client";

import { useEffect, useMemo, useState } from "react";

import { useCheckCartMutation } from "../store/shopApi.js";

// Asks the server whether each item in the bag is still offered, and in the
// quantity held, by the store that currently supplies the website. The answer
// can change under a shopper's feet — the shop's source store is switched in
// the dashboard, stock moves — so the bag and checkout re-ask whenever its
// contents change and show the reason beside the item rather than failing later
// at "place order".
//
// `blocking` is true while any item cannot be bought as it stands (not offered,
// out of stock, or fewer available than held); `pending` is true until the
// first answer for the current contents arrives, so a page can avoid flashing
// a green light it has not earned.
export function useCartCheck(items) {
  const [check] = useCheckCartMutation();
  const payload = useMemo(
    () =>
      (items || [])
        .filter((i) => i.product || i.productId)
        .map((i) => ({ productId: String(i.productId ?? i.product?._id), variantId: String(i.variantId), quantity: i.quantity })),
    [items],
  );
  const key = JSON.stringify(payload);
  const [answer, setAnswer] = useState({ key: "", byItem: {} });

  useEffect(() => {
    if (!payload.length) return undefined;
    let cancelled = false;
    check({ items: payload })
      .unwrap()
      .then((res) => {
        if (cancelled) return;
        setAnswer({ key, byItem: Object.fromEntries(res.items.map((r) => [`${r.productId}-${r.variantId}`, r])) });
      })
      .catch(() => {
        // A failed check is not a reason to stop someone shopping: checkout
        // still enforces availability on the server.
        if (!cancelled) setAnswer({ key, byItem: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [key, payload, check]);

  const fresh = answer.key === key;
  const byItem = fresh ? answer.byItem : {};
  return {
    pending: payload.length > 0 && !fresh,
    resultFor: (productId, variantId) => byItem[`${productId}-${variantId}`] ?? null,
    blocking: Object.values(byItem).some((r) => r.status !== "ok"),
    problems: Object.values(byItem).filter((r) => r.status !== "ok"),
  };
}
