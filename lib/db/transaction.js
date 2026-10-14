// The transaction helper on its own, with NO dependency beyond the connection
// pool. lib/db/tx.js re-exports it (and isDuplicateKeyError, which drags in
// lib/http.js -> next/server); models/productModel.js imports THIS file
// instead, because plain-Node scripts (scripts/seedCatalog.mjs, the migration
// runner) load that model and cannot resolve "next/server".
import { withConnection } from "../../config/db.js";

/**
 * Runs `fn(conn)` inside a real InnoDB transaction — used by order
 * creation/cancellation (services/orders/). Commits on success, rolls back
 * (and re-throws) on any error — including an `HttpError` a callback throws
 * deliberately to abort (e.g. "insufficient stock").
 */
export async function withTransaction(fn) {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // Rollback itself failing (e.g. connection already dropped) must
        // not mask the original error that triggered it.
      }
      throw err;
    }
  });
}
