import { query } from "../config/db.js";

// Whether a column exists in the connected database. Lets code that depends
// on an additive migration (e.g. 0006_image_framing) keep working — and keep
// its ordinary writes untouched — on a database where that migration hasn't
// been applied yet, instead of failing every save with "Unknown column".
// A found column is cached for the process lifetime; a missing one is
// re-checked after a short delay so applying the migration takes effect
// without a restart.
const found = new Set();
const missingAt = new Map();
const RECHECK_MS = 15_000;

export async function columnExists(table, column) {
  const key = `${table}.${column}`;
  if (found.has(key)) return true;
  const checkedAt = missingAt.get(key);
  if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return false;
  const rows = await query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  if (Number(rows[0].n) > 0) {
    found.add(key);
    missingAt.delete(key);
    return true;
  }
  missingAt.set(key, Date.now());
  return false;
}

export function resetColumnExistsCache() {
  found.clear();
  missingAt.clear();
}
