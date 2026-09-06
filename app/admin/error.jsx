"use client";

// Phase 10 — admin-section error boundary. Wraps everything under
// app/admin/layout.jsx (which already gates on staff role server-side —
// this boundary only ever renders for a genuine staff user, so its copy
// can safely say "admin" without leaking anything to an unauthenticated
// visitor). Same `{ error, retry }` contract as the root error.jsx —
// never renders error.message/stack/digest-adjacent details beyond the
// digest itself.
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { logClientErrorSafely } from "@/lib/clientErrorLog.js";

export default function AdminError({ error, retry }) {
  useEffect(() => {
    logClientErrorSafely("admin_route_error_boundary", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-10 text-center">
      <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-muted text-danger">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <h1 className="text-xl font-bold">This admin page hit a problem</h1>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        Nothing was saved or lost — try again, or head back to the dashboard overview.
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <RotateCw className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Try again
        </button>
        <Link
          href="/admin"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:border-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
