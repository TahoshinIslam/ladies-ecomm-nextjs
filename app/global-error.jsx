"use client";

// Phase 10 — root-layout error boundary. Only fires when the ROOT LAYOUT
// ITSELF throws (a normal segment error never reaches here — see
// error.jsx). Per Next.js 16.3.4's own docs (node_modules/next/dist/docs
// /01-app/03-api-reference/03-file-conventions/error.md): this file
// "must define its own <html> and <body> tags" (it replaces the root
// layout when active) and "does not include your global styles" — the
// globals.css import lives in app/layout.js, which this component does
// NOT render, so no Tailwind utility class below would actually apply.
// Every style here is inline for that reason. Same `{ error, retry }`
// contract as error.jsx, and the same rule: never render error.message/
// stack — just the generic message plus the opaque digest correlation id.
import { useEffect } from "react";

export default function GlobalError({ error, retry }) {
  useEffect(() => {
    console.error("Root layout error boundary:", error?.digest || error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "32px",
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#18181b",
          background: "#f3f0e8",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "clamp(24px,4vw,34px)", fontWeight: 600 }}>
          TAHOS. is temporarily unavailable
        </h1>
        <p style={{ margin: 0, maxWidth: "44ch", fontSize: "15px", lineHeight: 1.6, color: "#57534e" }}>
          Something went wrong loading the app. Please try again in a moment.
        </p>
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: "44px",
              padding: "0 20px",
              borderRadius: "10px",
              border: "none",
              background: "#18181b",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* A plain <a>, not next/link, is deliberate here and matches
              Next's own documented global-error example: this component
              replaces the root layout (and everything the App Router
              normally provides) precisely when something has already
              gone wrong at that level — relying on client-side route
              transitions in the same failed tree isn't the safe choice
              a full page navigation is. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              height: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: "10px",
              border: "1px solid #d6d3d1",
              color: "#18181b",
              fontSize: "14px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
