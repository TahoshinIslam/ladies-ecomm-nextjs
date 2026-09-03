"use client";

import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

import Button from "../ui/Button.jsx";
import { cn } from "../../lib/utils.js";

/**
 * The one shared "this failed" state for the admin panel — a query
 * erroring (bad/expired session, 500, network drop) must never render the
 * same way as a genuinely empty table. Every admin page's isError branch
 * and AdminLayout's own access-control states route through this so the
 * failure always looks like a failure, not like "there's nothing here yet."
 *
 * Pass either `onRetry` (real API failures — shows a Retry button that
 * re-runs the query) or `actionLabel`/`actionHref` (states retrying can't
 * fix, e.g. "you don't have access" → a link back to the storefront).
 */
export default function AdminErrorState({
  title = "Something went wrong",
  message = "Please try again.",
  onRetry,
  retrying = false,
  actionLabel,
  actionHref,
  compact = false,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger/5 text-center",
        compact ? "gap-2 p-6" : "gap-3 p-12",
      )}
    >
      <AlertTriangle className={cn("text-danger", compact ? "h-6 w-6" : "h-8 w-8")} />
      <div>
        <h3 className={cn("font-heading font-bold", compact ? "text-sm" : "text-lg")}>{title}</h3>
        <p className={cn("mt-1 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{message}</p>
      </div>
      {onRetry && (
        <Button size={compact ? "sm" : "md"} variant="outline" onClick={onRetry} loading={retrying}>
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
      {actionHref && actionLabel && (
        <Link href={actionHref}>
          <Button size={compact ? "sm" : "md"} variant="outline">
            {actionLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}
