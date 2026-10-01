import { randomBytes } from "node:crypto";

import { query } from "../config/db.js";
import { getOrganizationId } from "../lib/tenant.js";

// The storefront's half of the inventory model owned by the admin dashboard
// (ecom_erp migrations 064–066). The dashboard's packages/services/
// stock-ledger.service.js is the other half; the rules here must stay the
// same as its rules, and both are exercised against the same tables:
//
//   stock_levels        on_hand / reserved per (location, variant)
//   stock_reservations  one row per order line promised stock
//   stock_movements     append-only ledger of every on_hand change
//
// What the storefront does with it:
//
//   checkout  reserves at ONE location that fills online orders: the first
//             eligible one, by priority, that can cover the whole order
//             (stock_locations.fulfils_online / fulfilment_priority, set in the
//             dashboard under Inventory → Locations). Split fulfilment is not
//             supported: an order no single eligible location can cover is
//             refused, so the shop never accepts what it cannot send.
//             `reserved` goes up, on_hand does not — the goods are still on
//             the shelf. Each reservation is a conditional UPDATE that also
//             excludes units in lots past their expiry date, so two shoppers
//             racing for the last unit cannot both win and expired stock is
//             never promised.
//   cancel    releases active reservations (nothing physical moved).
//   dispatch  happens in the dashboard, which turns reservations into
//             `sale` movements. The storefront never decreases on_hand.
//
// `product_variants.stock` — which every listing and product page reads —
// is kept equal to `online_available()` (ecom_erp migration 075) by triggers,
// inside the same transaction: the most ONE eligible location can supply,
// after expired lots. It is a cache for listings; checkout re-checks with the
// conditional UPDATE below and never trusts it. Nothing here writes it.

export class InsufficientStockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InsufficientStockError";
    this.details = details;
  }
}

const newId = (prefix) => `${prefix}_${randomBytes(8).toString("hex")}`;

// "Abaya — Black / M": how the dashboard's ledger names a variant (its
// stock-ledger.service itemLabel), so both apps' movements read alike.
function itemLabel(productName, variant) {
  const name = String(productName || "");
  const vname = String(variant.variantName || variant.variant_name || "");
  return vname && vname !== variant.sku && vname !== name ? `${name} — ${vname}` : name;
}

async function run(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

/** The location online orders reserve from, or null if the store has none. */
export async function getDefaultLocationId(conn) {
  const rows = conn
    ? await run(conn, "SELECT default_location_id AS id FROM inventory_settings WHERE organization_id = ?", [getOrganizationId()])
    : await query("SELECT default_location_id AS id FROM inventory_settings WHERE organization_id = ?", [getOrganizationId()]);
  return rows[0]?.id ?? null;
}

/**
 * Only for the storefront's own product-creation path (seed scripts and test
 * fixtures): a store that has never had a location gets the same default the
 * dashboard's migration and provisioning would have given it.
 */
async function ensureDefaultLocation(conn) {
  const organizationId = getOrganizationId();
  const existing = await getDefaultLocationId(conn);
  if (existing) return existing;

  // Same choice as the dashboard's ensureDefaultLocation: the primary
  // branch's location, else the first active one by name, else a new one
  // named after the primary branch (or "Main stock" when there is none).
  const [org] = await run(conn, "SELECT primary_branch_id AS id FROM organizations WHERE id = ?", [organizationId]);
  const primaryBranchId = org?.id ?? null;
  const [location] = await run(
    conn,
    `SELECT id FROM stock_locations WHERE organization_id = ? AND status = 'Active'
      ORDER BY (branch_id <=> ?) DESC, name LIMIT 1`,
    [organizationId, primaryBranchId],
  );
  let locationId = location?.id;
  if (!locationId) {
    const [branch] = primaryBranchId
      ? await run(conn, "SELECT id, name, code FROM branches WHERE organization_id = ? AND id = ? AND deleted_at IS NULL", [
          organizationId,
          primaryBranchId,
        ])
      : [];
    locationId = newId("loc");
    await run(
      conn,
      `INSERT INTO stock_locations (id, organization_id, branch_id, name, code, location_type, status, fulfils_online, fulfilment_priority, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, 'Active', 1, 1, 'Storefront')`,
      [
        locationId,
        organizationId,
        branch?.id ?? null,
        branch?.name ?? "Main stock",
        String(branch?.code ?? "MAIN").toUpperCase().slice(0, 32),
        branch ? "store" : "warehouse",
      ],
    );
  }
  await run(
    conn,
    `INSERT INTO inventory_settings (organization_id, default_location_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE default_location_id = COALESCE(default_location_id, VALUES(default_location_id))`,
    [organizationId, locationId],
  );
  // The default is where online orders are filled from, so it is always an
  // eligible location (a priority already chosen is kept).
  await run(
    conn,
    `UPDATE stock_locations SET fulfils_online = 1, fulfilment_priority = COALESCE(fulfilment_priority, 1)
      WHERE organization_id = ? AND id = ?`,
    [organizationId, locationId],
  );
  return getDefaultLocationId(conn);
}

/**
 * A new variant's starting quantity, as an `opening` movement at the default
 * location — the same shape the dashboard writes when its product form
 * creates a variant with stock.
 */
export async function postOpeningStock(conn, { productId, productName, variant, quantity }) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return;
  const organizationId = getOrganizationId();
  const locationId = await ensureDefaultLocation(conn);

  await run(
    conn,
    `INSERT INTO stock_levels (organization_id, location_id, variant_id, product_id, on_hand, reserved)
     VALUES (?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE on_hand = on_hand + VALUES(on_hand)`,
    [organizationId, locationId, variant.id, productId, qty],
  );
  const [level] = await run(
    conn,
    "SELECT on_hand FROM stock_levels WHERE organization_id = ? AND location_id = ? AND variant_id = ?",
    [organizationId, locationId, variant.id],
  );
  await run(
    conn,
    `INSERT INTO stock_movements
       (organization_id, location_id, variant_id, product_id, sku, item_name, movement_type, quantity,
        on_hand_after, unit_cost, source_type, source_id, source_line_id, reason, note, actor_name)
     VALUES (?, ?, ?, ?, ?, ?, 'opening', ?, ?, NULL, 'product', ?, ?, ?, 'Cost unknown.', 'Storefront')`,
    [
      organizationId,
      locationId,
      variant.id,
      productId,
      variant.sku || "",
      itemLabel(productName, variant).slice(0, 500),
      qty,
      level.on_hand,
      productId,
      variant.id,
      "Opening stock entered with the new variant",
    ],
  );
}

/**
 * The branch that fulfils an order reserved at `locationId`: the location's
 * branch, if it is a real one — same organization, not deleted, active.
 * Otherwise null, which is stored as "unassigned" rather than guessed.
 */
async function branchOfLocation(conn, locationId) {
  const rows = await run(
    conn,
    `SELECT b.id
       FROM stock_locations l
       JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
      WHERE l.organization_id = ? AND l.id = ?
        AND b.deleted_at IS NULL AND b.status = 'Active'`,
    [getOrganizationId(), locationId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Units of the item at this location that are still counted but sit in a lot
 * past its expiry date. They are never sold, so they are never promised.
 * (Same rule as ecom_erp's stock_availability view and online_available().)
 */
const EXPIRED_UNSWEPT = `COALESCE((
  SELECT SUM(ll.on_hand)
    FROM stock_lot_levels ll
    JOIN stock_lots lt ON lt.id = ll.lot_id AND lt.organization_id = ll.organization_id
   WHERE ll.organization_id = sl.organization_id AND ll.location_id = sl.location_id AND ll.variant_id = sl.variant_id
     AND lt.expiry_date IS NOT NULL AND lt.expiry_date < UTC_DATE()
), 0)`;

/**
 * Locations that may fill an online order, best first: active and marked
 * `fulfils_online`. The status of a location's branch does not make it
 * ineligible — the order is taken, and is saved with no fulfilment branch when
 * that branch is not active (see branchOfLocation). Ties on priority fall to
 * name, so the choice is repeatable.
 */
async function eligibleLocations(conn) {
  return run(
    conn,
    `SELECT l.id, l.name, l.branch_id AS branchId
       FROM stock_locations l
      WHERE l.organization_id = ? AND l.status = 'Active' AND l.fulfils_online = 1
      ORDER BY l.fulfilment_priority IS NULL, l.fulfilment_priority, l.name, l.id`,
    [getOrganizationId()],
  );
}

/**
 * Reserve every line of a new order at ONE eligible location, inside the
 * order's transaction. Throws InsufficientStockError — rolling the whole
 * order back — when any line cannot be covered by AVAILABLE stock.
 *
 * `lines` are the order's own rows (`order_items.id` included), so each
 * reservation names the exact line it promises stock to; the unique key on
 * order_item_id makes a second reservation for the same line impossible.
 *
 * The same location that backs the reservations decides the order's
 * fulfilment branch (`orders.branch_id`), written in this same transaction —
 * not a second lookup of "the default", which could name a different
 * location. The assignment is a fact about this order: changing the default
 * location later does not move it. A location with no valid branch leaves the
 * order explicitly unassigned (branch_id NULL); the dashboard reports those.
 *
 * Returns { locationId, branchId } (branchId null when unassigned).
 */
export async function reserveOrder(conn, orderId, lines) {
  const organizationId = getOrganizationId();
  const candidates = await eligibleLocations(conn);
  if (!candidates.length) {
    throw new InsufficientStockError("This store has no location set up to fill online orders yet, so it cannot take orders.");
  }

  // Fixed order, so two checkouts reserving the same items cannot deadlock.
  const ordered = [...lines].sort((a, b) => String(a.variantId).localeCompare(String(b.variantId)));
  let firstShortage = null;

  for (const location of candidates) {
    // A location that cannot cover every line is abandoned wholesale: the
    // savepoint takes back any line already reserved there.
    await run(conn, "SAVEPOINT reserve_attempt", []);
    let covered = true;
    for (const line of ordered) {
      const [result] = await conn.query(
        `UPDATE stock_levels sl SET sl.reserved = sl.reserved + ?
          WHERE sl.organization_id = ? AND sl.location_id = ? AND sl.variant_id = ?
            AND sl.on_hand - sl.reserved - ${EXPIRED_UNSWEPT} >= ?`,
        [line.quantity, organizationId, location.id, line.variantId, line.quantity],
      );
      if (result.affectedRows !== 1) {
        covered = false;
        firstShortage ??= line;
        break;
      }
    }
    if (!covered) {
      await run(conn, "ROLLBACK TO SAVEPOINT reserve_attempt", []);
      continue;
    }

    for (const line of ordered) {
      await run(
        conn,
        `INSERT INTO stock_reservations
           (id, organization_id, location_id, order_id, order_item_id, variant_id, product_id, quantity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [newId("rsv"), organizationId, location.id, orderId, line.orderItemId, line.variantId, line.productId, line.quantity],
      );
    }
    await run(conn, "RELEASE SAVEPOINT reserve_attempt", []);

    const branchId = await branchOfLocation(conn, location.id);
    if (branchId) {
      await run(conn, "UPDATE orders SET branch_id = ? WHERE organization_id = ? AND id = ? AND branch_id IS NULL", [
        branchId,
        organizationId,
        orderId,
      ]);
    }
    return { locationId: location.id, branchId };
  }

  throw new InsufficientStockError(
    `Insufficient stock for ${firstShortage?.sku || "an item"}` +
      (candidates.length > 1 ? " — no single location can supply this whole order" : ""),
    { variantId: firstShortage?.variantId },
  );
}

/**
 * Release an order's active reservations — the order will not ship. Locked
 * rows first, so a concurrent dispatch in the dashboard and this cancel
 * serialise; a reservation already consumed (dispatched) is left alone.
 */
export async function releaseOrder(conn, orderId, reason) {
  const organizationId = getOrganizationId();
  const reservations = await run(
    conn,
    `SELECT id, location_id, variant_id, quantity FROM stock_reservations
      WHERE organization_id = ? AND order_id = ? AND status = 'active'
      FOR UPDATE`,
    [organizationId, orderId],
  );
  for (const r of reservations) {
    const [result] = await conn.query(
      `UPDATE stock_levels SET reserved = reserved - ?
        WHERE organization_id = ? AND location_id = ? AND variant_id = ? AND reserved >= ?`,
      [r.quantity, organizationId, r.location_id, r.variant_id, r.quantity],
    );
    if (result.affectedRows !== 1) {
      throw new Error(`Reservation ${r.id} could not be released: its reserved stock is missing`);
    }
    await run(
      conn,
      `UPDATE stock_reservations SET status = 'released', resolved_at = NOW(3), resolved_reason = ?
        WHERE organization_id = ? AND id = ? AND status = 'active'`,
      [String(reason || "").slice(0, 120), organizationId, r.id],
    );
  }
  return reservations.length;
}

/**
 * What the shop can offer of one variant — the most one eligible location can
 * supply — and the reorder point of the location that supplies it, for the
 * low-stock alert raised after an order.
 */
export async function findOnlineLevel(variantId) {
  const rows = await query(
    `SELECT GREATEST(sl.on_hand - sl.reserved - ${EXPIRED_UNSWEPT}, 0) AS available, sl.reorder_point AS reorderPoint
       FROM stock_levels sl
       JOIN stock_locations l ON l.id = sl.location_id AND l.organization_id = sl.organization_id
      WHERE sl.organization_id = ? AND sl.variant_id = ? AND l.status = 'Active' AND l.fulfils_online = 1
      ORDER BY available DESC, l.fulfilment_priority IS NULL, l.fulfilment_priority
      LIMIT 1`,
    [getOrganizationId(), variantId],
  );
  return rows[0] ?? null;
}
