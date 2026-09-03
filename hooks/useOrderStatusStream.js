"use client";

import { useEffect } from "react";
import { useSelector } from "react-redux";

import { selectAuthToken } from "../store/authSlice.js";

/**
 * Subscribes to /api/orders/[id]/events and calls onUpdate(payload) whenever
 * the order's status changes server-side — an admin updating status reaches
 * the customer's open order page immediately instead of waiting for a
 * manual refresh. Silently no-ops without a token or orderId; reconnection
 * on drop is handled by EventSource itself (it retries automatically).
 */
export function useOrderStatusStream(orderId, onUpdate) {
  const token = useSelector(selectAuthToken);

  useEffect(() => {
    if (!orderId || !token) return;

    const source = new EventSource(`/api/orders/${orderId}/events?token=${encodeURIComponent(token)}`);
    const handleUpdate = (e) => {
      try {
        onUpdate(JSON.parse(e.data));
      } catch {
        // malformed payload — ignore, next event will still arrive
      }
    };
    source.addEventListener("ORDER_STATUS_UPDATED", handleUpdate);

    return () => {
      source.removeEventListener("ORDER_STATUS_UPDATED", handleUpdate);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, token]);
}
