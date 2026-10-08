// What this storefront calls itself.
//
// The name is whatever the owner typed under Storefront → Settings; until they do, it is the store's own name — the
// organization the dashboard provisioned — never another shop's. The database's column default ("My Store") is a
// placeholder, not a choice, so it counts as "not set yet".
import { query } from "../config/db.js";
import { getOrganizationId } from "./tenant.js";

export const PLACEHOLDER_STORE_NAME = "My Store";

/** The name to show, given what the settings row holds and the organization's own name. */
export function resolveStoreName(settingsName, organizationName) {
  const typed = String(settingsName ?? "").trim();
  if (typed && typed !== PLACEHOLDER_STORE_NAME) return typed;
  return String(organizationName ?? "").trim() || typed;
}

/** The organization's own name (`organizations.name`) — not tenant-scoped data, it is the tenant's identity. */
export async function getOrganizationName() {
  const rows = await query("SELECT name FROM organizations WHERE id = ?", [getOrganizationId()]);
  return rows[0]?.name ?? "";
}

const MEMO_MS = 60 * 1000;
const memo = new Map();

/**
 * The resolved name, for places that run on every request (page titles, emails): a plain read kept for a minute,
 * apart from the settings cache — a rename shows up within a minute without touching that cache's timing.
 */
export async function getStoreName() {
  const organizationId = getOrganizationId();
  const hit = memo.get(organizationId);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.name;
  let name = "";
  try {
    const rows = await query(
      `SELECT s.store_name AS storeName, o.name AS organizationName
         FROM organizations o
         LEFT JOIN store_settings s ON s.organization_id = o.id
        WHERE o.id = ?`,
      [organizationId],
    );
    name = resolveStoreName(rows[0]?.storeName, rows[0]?.organizationName);
  } catch {
    // A page must still render if this one read fails; the next request tries again.
    return hit?.name ?? "";
  }
  memo.set(organizationId, { name, at: Date.now() });
  return name;
}

/** For tests: forget what was remembered. */
export function forgetStoreName() {
  memo.clear();
}
