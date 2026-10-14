// @ts-check
/**
 * Which store this storefront serves.
 *
 * Every table this app reads now lives in a database shared with the admin
 * dashboard and with other stores, so "the products" no longer means a whole
 * table — it means the rows carrying this store's `organization_id`. There is
 * no query in this app that may leave that out, and forgetting it does not
 * fail: it silently serves another shop's catalog, customers and orders.
 *
 * Resolved once per process from the environment. This app is one store's
 * storefront, not a multi-tenant router — a deployment serves exactly one
 * organization, and which one is configuration, not request state. When that
 * stops being true (one deployment serving many shops by hostname), this is
 * the single place that changes: `getOrganizationId()` starts taking the
 * request's host, and every call site already asks the question rather than
 * hard-coding an answer.
 */

/** @type {string | undefined} */
let cached;

export function getOrganizationId() {
  if (cached) return cached;

  const id = process.env.STORE_ORGANIZATION_ID?.trim();

  if (!id) {
    throw new Error(
      "STORE_ORGANIZATION_ID is not set. This storefront reads a database shared " +
        "with other stores, so it cannot run without knowing which organization " +
        "it serves — serving every store's rows at once is the failure mode this " +
        "prevents. Set it to the organization id the admin dashboard lists for " +
        "this shop (see .env.example).",
    );
  }

  cached = id;
  return cached;
}
