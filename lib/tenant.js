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

/**
 * The scoping predicate, as SQL plus its parameter.
 *
 * Returned together so a call site cannot add the condition and forget the
 * value, or reorder its parameters past it. `alias` names the table when a
 * query joins more than one:
 *
 *   const org = orgScope("p");
 *   query(`SELECT * FROM products p WHERE ${org.sql} AND p.is_active = 1`,
 *         [...org.params, ...]);
 */
export function orgScope(alias) {
  const column = alias ? `${alias}.organization_id` : "organization_id";
  return { sql: `${column} = ?`, params: [getOrganizationId()], column };
}

/** For INSERTs: the column and its value, to spread into a row object. */
export function orgColumn() {
  return { organization_id: getOrganizationId() };
}
