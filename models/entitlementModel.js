import { query } from "../config/db.js";
import { getOrganizationId } from "../lib/tenant.js";

// Which modules this store's PLAN lets it use, read from the shared database on every call (never cached: a downgrade must take
// effect on the next request, not after a restart). It is the dashboard's own expression — `findEntitledModuleIds` in
// ecom_erp/packages/repositories/access.repository.js — kept identical on purpose: everything the plan includes, plus ENABLE grants
// that have not expired, minus DISABLE grants. The question is about the MERCHANT's organization (`STORE_ORGANIZATION_ID`), never
// about the shopper: a customer has no plan and no staff permission.
export const STOREFRONT_MODULE = "mod.storefront";

export async function isModuleEntitled(moduleId, conn) {
  const organizationId = getOrganizationId();
  const sql = `SELECT 1 AS entitled
       FROM (
              SELECT pm.module_id
                FROM subscriptions s
                JOIN plan_modules pm ON pm.plan_id = s.plan_id
               WHERE s.organization_id = ?
              UNION
              SELECT g.module_id
                FROM organization_module_grants g
               WHERE g.organization_id = ? AND g.grant_type = 'ENABLE' AND (g.expires_at IS NULL OR g.expires_at > NOW())
            ) AS candidate
      WHERE candidate.module_id = ?
        AND NOT EXISTS (
              SELECT 1 FROM organization_module_grants d
               WHERE d.organization_id = ? AND d.module_id = candidate.module_id AND d.grant_type = 'DISABLE'
            )
      LIMIT 1`;
  const params = [organizationId, organizationId, moduleId, organizationId];
  const [rows] = conn ? await conn.query(sql, params) : [await query(sql, params)];
  return Array.isArray(rows) && rows.length > 0;
}
