"use client";

import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";

import { selectCurrentUser } from "../store/authSlice.js";
import { shopApi } from "../store/shopApi.js";

/**
 * One subscription per signed-in customer (mounted once from Header.jsx,
 * the one component every storefront page renders) to /api/user/events —
 * "order updates live, delivery status": an admin marking an order
 * shipped/delivered/cancelled reaches this shopper's own open tab
 * immediately (bell count + toast) instead of waiting for
 * NotificationsDropdown-equivalent's fallback poll. Mirrors
 * useAdminEventStream.js's shape, simplified: a customer's bell has only
 * one event type worth reacting to (NEW_NOTIFICATION, written by
 * services/notificationService.js's createUserNotification) — no
 * per-table cache tags to also refresh, since there's no admin-style data
 * table on the storefront listening for these.
 */
export function useUserEventStream() {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!user) return;

    // Same dedup/resume reasoning as useAdminEventStream.js — the server
    // emits `id: <mongoId>` per event, which EventSource resends as
    // `Last-Event-ID` on its own automatic reconnect.
    const seenEventIds = new Set();
    const MAX_SEEN = 100;
    const alreadySeen = (id) => {
      if (!id) return false;
      if (seenEventIds.has(id)) return true;
      seenEventIds.add(id);
      if (seenEventIds.size > MAX_SEEN) {
        seenEventIds.delete(seenEventIds.values().next().value);
      }
      return false;
    };

    // Same-origin session cookie is sent automatically by EventSource.
    const source = new EventSource("/api/user/events");
    const handleNotification = (e) => {
      if (alreadySeen(e.lastEventId)) return;
      let payload;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(shopApi.util.invalidateTags(["Notification"]));
      if (payload.message) toast.message(payload.message);
    };
    source.addEventListener("NEW_NOTIFICATION", handleNotification);

    return () => {
      source.removeEventListener("NEW_NOTIFICATION", handleNotification);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);
}
