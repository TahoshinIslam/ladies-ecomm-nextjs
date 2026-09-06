"use client";

// Phase 10 — root segment error boundary. Wraps every route under the
// root layout (everything except the root layout itself — see
// global-error.jsx for that). Next.js 16.3.4's real contract for this
// file is `{ error, retry }` (confirmed against the installed
// node_modules/next/dist/docs — `retry` is the current, stable recovery
// function; `reset` still exists but the docs now call `retry` the
// primary one). Never renders `error.message`/`error.stack` — Server
// Component errors already arrive here with a generic message in
// production (Next's own behavior), and this UI doesn't add anything
// more specific than that, so nothing sensitive can leak regardless of
// what actually failed server-side.
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCw } from "lucide-react";
import { logClientErrorSafely } from "@/lib/clientErrorLog.js";

export default function ErrorBoundary({ error, retry }) {
  const [retrying, setRetrying] = useState(false);
  const statusId = useId();

  useEffect(() => {
    // Phase 11 — never logs the full Error object (message/stack/props)
    // to the browser console in production; only a fixed event name plus
    // the opaque digest, if one exists. See lib/clientErrorLog.js.
    logClientErrorSafely("route_error_boundary", error);
  }, [error]);

  // Phase 10 checkpoint — explicit policy decision: never show
  // error.digest to the end user. This app has no documented
  // "quote this reference to support" workflow anywhere (its one real
  // support channel, settings.store.supportEmail in the footer, doesn't
  // ask for one) — displaying an opaque hash with no way for a real
  // person to act on it would just be confusing, unlabeled technical
  // noise. The digest is still logged to the console above (and to
  // server-side logs by Next itself) for engineering correlation.

  const handleRetry = () => {
    setRetrying(true);
    retry();
    // retry() re-renders synchronously-ish; if the same error recurs the
    // component remounts with a fresh `error` prop, so there's no need to
    // reset `retrying` from here — a fresh mount starts at false again.
  };

  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-media text-verm">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.8} />
      </span>
      <h1 className="mt-6 text-[clamp(28px,3.6vw,40px)] font-semibold tracking-[-0.03em]">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-[46ch] text-[15.5px] leading-relaxed text-stone">
        This page ran into a problem loading. It isn&rsquo;t you — try again, or head back to somewhere safe.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-ink px-6 text-sm font-semibold text-canvas transition-colors hover:bg-verm focus-ring"
        >
          <RotateCw className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-line px-6 text-sm font-semibold transition-colors hover:border-ink focus-ring"
        >
          <Home className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Go home
        </Link>
      </div>
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {retrying ? "Retrying…" : ""}
      </p>
    </div>
  );
}
