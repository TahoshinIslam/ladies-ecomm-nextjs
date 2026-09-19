// The transaction helper on its own, with NO dependency beyond the connection
// pool. lib/db/tx.js re-exports it (and isDuplicateKeyError, which drags in
// lib/http.js -> next/server); models/productModel.js imports THIS file
// instead, because plain-Node scripts (scripts/seedCatalog.mjs, the migration
// runner) load that model and cannot resolve "next/server".
import { withConnection } from "../../config/db.js";

/**
 * Runs `fn(conn)` inside a real InnoDB transaction — the SQL equivalent of
 * the old `mongoose.startSession()` + `session.withTransaction(cb)` pattern
 * used by order creation/cancellation (services/orderService.js). Commits
 * on success, rolls back (and re-throws) on any error — including an
 * `HttpError` a callback throws deliberately to abort (e.g. "insufficient
 * stock"), exactly like the Mongoose version aborting the whole transaction
 * when its callback throws.
 *
 * Unlike Mongoose's multi-document-replica-set transactions, this needs no
 * replica set / cluster of any kind — a single InnoDB server already
 * supports real ACID transactions natively.
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
