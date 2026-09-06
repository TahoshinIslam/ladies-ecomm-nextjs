// Test-infrastructure-only Node ESM loader hook. Registered via the "test"
// npm script's `--import` flag — never loaded by the actual Next.js
// runtime, never touches application code.
//
// Why this exists: the Phase 1 test suites call Route Handlers (e.g.
// app/api/orders/route.js) directly, as plain functions, so tests can run
// against an isolated MONGO_URI_TEST database without a running Next.js
// server — going through a real `next dev`/`next start` server isn't an
// option here, because Next.js unconditionally sets its own NODE_ENV
// ("development"/"production"), which would make config/db.js's
// NODE_ENV==="test" branch (the only thing that ever selects
// MONGO_URI_TEST) unreachable.
//
// Route Handler files import from subpaths like "next/server" and
// "next/navigation". Next's own bundler (webpack/Turbopack) resolves these
// fine, but the "next" package ships no "exports" map in its package.json,
// and plain Node's ESM resolver — unlike Next's bundler — does not probe
// for a matching ".js" file on an extensionless subpath import in that
// case. The fix is exactly one file extension away (Node's own error even
// says "Did you mean to import next/server.js") — this hook applies that
// exact, narrow retry, and only for "next/*" specifiers, so it can't mask
// a genuine missing-module error anywhere else.

import { register } from "node:module";

register("./nextResolveHookImpl.mjs", import.meta.url);
