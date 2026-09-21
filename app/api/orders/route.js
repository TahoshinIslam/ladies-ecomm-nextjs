import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/auth.js";
import { createOrder } from "../../../services/orderService.js";
import { withRoute } from "../../../lib/http.js";
import { readIdempotencyKey } from "../../../lib/idempotency.js";
import { parseJsonBody } from "../../../lib/validation.js";
import { createOrderSchema } from "../../../schemas/orderSchemas.js";
import { invalidateCacheTags } from "../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../lib/cacheTags.js";

// Admin list — GET /api/orders?status=&search=&sortBy=&sortOrder=&page=&limit=

export const POST = withRoute(async (request) => {
  const user = await requireUser(request);
  // Read/validate the key before touching the body — auth and CSRF/Origin
  // (withRoute) still run first either way, this just fails cheaply on a
  // missing/malformed key before any JSON parsing or DB work happens.
  const idempotencyKey = readIdempotencyKey(request);
  // Phase 5 idempotency integration (section I): the body is validated and
  // NORMALIZED here (trimmed strings, coupon code uppercased, defaults
  // applied) before it ever reaches createOrder() — the Phase 4 request
  // fingerprint is computed from this same normalized shape, so two
  // semantically-equivalent requests (e.g. differing only in incidental
  // whitespace) hash identically, while a genuinely different order still
  // produces a different fingerprint. An invalid body throws here, before
  // any idempotency lookup/creation ever runs.
  const body = await parseJsonBody(request, createOrderSchema);
  const { order, replayed } = await createOrder(user._id, body, idempotencyKey);
  // Only a genuinely NEW order actually decremented stock (the sequential-
  // replay fast path inside createOrder() returns before touching stock at
  // all) — invalidate only then, after the real transaction has already
  // committed, never for a replay.
  if (!replayed) invalidateCacheTags([CACHE_TAGS.CATALOG, CACHE_TAGS.ADMIN_ANALYTICS]);
  return NextResponse.json(
    { success: true, order },
    {
      status: replayed ? 200 : 201,
      headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
    },
  );
});

// The staff-gated handler that used to live here (GET) went with the
// admin section: creating and editing the catalog is the dashboard's job now,
// and it writes an audit trail this app never did. The public handler above
// remains what the storefront actually needs.
