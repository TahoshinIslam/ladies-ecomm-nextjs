"use client";

import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";

import { selectCurrentUser } from "../store/authSlice.js";
import { shopApi } from "../store/shopApi.js";

// Every type here needs a table to live-refresh (TAGS_BY_TYPE). Only the
// ones genuinely worth interrupting someone for also get a toast+bell entry
// (TOAST_COPY) — a routine processing→shipped click shouldn't page the
// whole team, but a new order or a cancellation should.
const TOAST_COPY = {
  NEW_ORDER: (p) => `New order #${p.orderNumber} received`,
  ORDER_CANCELLED: (p) => `Order #${p.orderNumber} was cancelled`,
  LOW_STOCK_ALERT: (p) => (p.stock <= 0 ? `Out of stock: ${p.productName}` : `Low stock: ${p.productName} — only ${p.stock} left`),
  PRODUCT_CREATED: (p) => `Product created: ${p.name}`,
  PRODUCT_UPDATED: (p) => `Product updated: ${p.name}`,
  NEW_NOTIFICATION: (p) => p.message,
};

// Every event type that has a matching row written to the Notification
// collection server-side gets "Notification" invalidated unconditionally
// below — that's what makes the bell live. This map is the *other* half:
// which underlying admin TABLE also needs to refresh. Order status changes
// (including routine ones with no toast) still need this so one admin's
// click is reflected live for anyone else with the list open — missing
// this entirely for cancel/status-update was the reported bug.
const TAGS_BY_TYPE = {
  NEW_ORDER: ["Order"],
  ORDER_CANCELLED: ["Order"],
  ORDER_STATUS_CHANGED: ["Order"],
  LOW_STOCK_ALERT: ["Product"],
  PRODUCT_CREATED: ["Product"],
  PRODUCT_UPDATED: ["Product"],
};

/**
 * One admin-wide subscription (mounted once from AdminLayout) to
 * /api/admin/events — new orders, low-stock alerts, and product changes
 * reach every open admin session immediately instead of the 30s
 * notification poll.
 */
export function useAdminEventStream() {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const isStaff = user && ["admin", "employee"].includes(user.role);

  useEffect(() => {
    if (!isStaff) return;

    // Phase 11: the server now emits `id: <mongoId>` per event (see
    // app/api/admin/events/route.js) — the browser's native EventSource
    // tracks that as `lastEventId` and resends it as the `Last-Event-ID`
    // request header on its own automatic reconnect, resuming exactly
    // where this connection left off rather than replaying/missing
    // events. This Set is a small belt-and-suspenders client-side dedup
    // on top of that (the server's own `_id > lastSeenId` query already
    // guarantees no duplicates within one continuous poll/reconnect
    // cycle) — bounded so a long-lived connection can't grow it forever.
    const seenEventIds = new Set();
    const MAX_SEEN = 200;
    const alreadySeen = (id) => {
      if (!id) return false;
      if (seenEventIds.has(id)) return true;
      seenEventIds.add(id);
      if (seenEventIds.size > MAX_SEEN) {
        seenEventIds.delete(seenEventIds.values().next().value);
      }
      return false;
    };

    // Same-origin session cookie is sent automatically by EventSource — no
    // token in the URL (Phase 2: the old ?token=<jwt> workaround is gone).
    const source = new EventSource(`/api/admin/events`);
    const handleEvent = (e) => {
      if (alreadySeen(e.lastEventId)) return;
      let payload;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(shopApi.util.invalidateTags(["Notification", ...(TAGS_BY_TYPE[payload.type] || [])]));
      const describe = TOAST_COPY[payload.type];
      if (describe) toast.message(describe(payload));
    };

    // Derived from the two maps above rather than hand-listed — a type
    // present in only one of them (as ORDER_STATUS_CHANGED is: it refreshes
    // a table but has no toast) still needs a real addEventListener, since
    // EventSource only delivers a message to a listener registered for that
    // exact event name. A third hand-maintained list here is exactly how
    // ORDER_CANCELLED/ORDER_STATUS_CHANGED got missed the first time.
    const types = [...new Set([...Object.keys(TOAST_COPY), ...Object.keys(TAGS_BY_TYPE)])];
    for (const type of types) source.addEventListener(type, handleEvent);

    return () => {
      for (const type of types) source.removeEventListener(type, handleEvent);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff]);
}
