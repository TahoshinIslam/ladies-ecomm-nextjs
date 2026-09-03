"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";

import { cn } from "../../lib/utils.js";
import AdminErrorState from "./AdminErrorState.jsx";
import {
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} from "../../store/shopApi.js";

// Format a relative time string from an ISO date — small standalone helper
// so we don't pull in date-fns just for this.
const timeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
};

export default function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const router = useRouter();

  // Real-time delivery is useAdminEventStream (mounted once in
  // AdminLayout), which invalidates this query's cache tag the moment
  // something happens. This poll is just the fallback for a dropped SSE
  // connection — relaxed from 30s since it's no longer the primary path.
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useGetNotificationsQuery(
    { page: 1, limit: 10 },
    { pollingInterval: 60000 },
  );
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleClick = async (n) => {
    setOpen(false);
    if (!n.readAt) {
      try {
        await markRead(n._id).unwrap();
      } catch {
        /* non-fatal */
      }
    }
    if (n.url) router.push(n.url);
  };

  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    try {
      await markAll().unwrap();
    } catch {
      /* non-fatal */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        className="relative rounded-md p-2 text-foreground transition-colors hover:bg-muted focus-ring"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-background shadow-hover"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold">Notifications</p>
              <button
                onClick={handleMarkAll}
                disabled={unreadCount === 0 || marking}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent disabled:opacity-40"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : isError ? (
                <AdminErrorState compact title="Couldn't load notifications" onRetry={refetch} />
              ) : notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No notifications yet
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((n) => (
                    <li key={n._id}>
                      <button
                        onClick={() => handleClick(n)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                          !n.readAt && "bg-accent/5",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                            n.readAt ? "bg-transparent" : "bg-accent",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-sm",
                              n.readAt
                                ? "text-muted-foreground"
                                : "font-medium text-foreground",
                            )}
                          >
                            {n.message}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {timeAgo(n.createdAt)}
                          </p>
                        </div>
                        {n.readAt && (
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
