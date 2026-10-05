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
// What the storefront does with it (ecom_erp docs/inventory-foundation.md):
//
//   stock lives on RECEIPT BATCHES. One receipt of one variant is one batch with its
//   own purchase cost and selling price (stock_batches), held per location and
//   condition (stock_batch_levels). stock_levels is a projection of the sellable
//   batch levels, kept by database triggers — nothing here writes it. The same
//   variant received twice at different prices is two batches; online orders and the
//   dashboard's till draw on the same ones.
//
//   quote     planOrder() lays an order's lines over the batches an online order would
//             take them from — oldest received first, earliest expiry first for items
//             tracked by lot or expiry, never an expired lot — and returns, per line,
//             its segments { batchId, quantity, unitPrice }. Prices are the batches'
//             own; a promotional price applies to every batch. The cart, the preview and
//             checkout all call it, so what is shown is what checkout can make.
//   checkout  reserves at ONE location that fills online orders. When the dashboard has
//             chosen a Product Source Store (inventory_settings.online_source_location_id)
//             that is the only candidate, read inside the order's own transaction so
//             validation, pricing and reservation agree on it. With none chosen it is the
//             first eligible one, by priority, that can cover the whole order. Split
//             fulfilment is not supported: an order the one location cannot cover is
//             refused. The batch rows are read FOR UPDATE and each reservation is a guarded
//             UPDATE of stock_batch_levels.reserved (the goods stay on the shelf), so two
//             shoppers racing for the last unit cannot both win, and expired stock is never
//             promised. Each order line's reservation names its batches
//             (stock_batch_allocations), with the price quoted and the cost as it stood —
//             provisional until the dashboard dispatches.
//   cancel    releases active reservations batch by batch (nothing physical moved).
//   dispatch  happens in the dashboard, which consumes the reserved batches into `sale`
//             movements and records the batches' costs as actual. The storefront never
//             decreases on_hand.
//
// `product_variants.stock` — which every listing and product page reads — is kept equal to
// `online_available()` by triggers, and the price a listing shows is `online_next_price()`
// (ecom_erp migration 090): the next batch's price. Both are caches for listings; checkout
// re-checks and re-prices with the locked reads below and never trusts them. A purchase
// cost never leaves this module: quotes and order lines carry prices only.

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
 * The store the dashboard chose to supply the website (ecom_erp migration 083),
 * with the version the storefront keys its caches on. `locationId` is null when
 * none is chosen — then the shop behaves as it did before the setting existed.
 *
 * With a connection, the row is read `LOCK IN SHARE MODE`: a checkout holds it
 * until it commits, so the dashboard's switch waits for in-flight orders and an
 * order never sees two different sources between its checks and its reservation.
 */
export async function getOnlineSource(conn) {
  const sql = "SELECT online_source_location_id AS locationId, online_assortment_version AS version FROM inventory_settings WHERE organization_id = ?";
  const rows = conn ? await run(conn, `${sql} LOCK IN SHARE MODE`, [getOrganizationId()]) : await query(sql, [getOrganizationId()]);
  return { locationId: rows[0]?.locationId ?? null, version: Number(rows[0]?.version ?? 0) };
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
 * A new variant's starting quantity: an OPENING batch at the default location (cost unknown,
 * priced at the variant's price) and the `opening` movement that explains it — the same shape
 * the dashboard writes when its product form creates a variant with stock. The batch level is
 * the quantity; stock_levels follows by trigger.
 */
export async function postOpeningStock(conn, { productId, productName, variant, quantity }) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return;
  const organizationId = getOrganizationId();
  const locationId = await ensureDefaultLocation(conn);

  const [priced] = await run(
    conn,
    `SELECT COALESCE(pv.price, p.base_price) AS price
       FROM product_variants pv JOIN products p ON p.id = pv.product_id AND p.organization_id = pv.organization_id AND p.deleted_at IS NULL
      WHERE pv.organization_id = ? AND pv.id = ?`,
    [organizationId, variant.id],
  );
  const batchId = newId("bat");
  await run(
    conn,
    `INSERT INTO stock_batches
       (id, organization_id, variant_id, product_id, origin, source_type, source_id, source_line_id, unit_cost, cost_source,
        selling_price, price_source, quantity_received, created_by_name)
     VALUES (?, ?, ?, ?, 'opening', 'product', ?, ?, NULL, 'unknown', ?, 'variant_default', ?, 'Storefront')`,
    [batchId, organizationId, variant.id, productId, productId, variant.id, Number(priced?.price ?? 0), qty],
  );
  await run(
    conn,
    `INSERT INTO stock_batch_levels (organization_id, location_id, batch_id, item_condition, variant_id, product_id, quantity, reserved)
     VALUES (?, ?, ?, 'sellable', ?, ?, ?, 0)`,
    [organizationId, locationId, batchId, variant.id, productId, qty],
  );
  const [level] = await run(
    conn,
    "SELECT on_hand FROM stock_levels WHERE organization_id = ? AND location_id = ? AND variant_id = ?",
    [organizationId, locationId, variant.id],
  );
  await run(
    conn,
    `INSERT INTO stock_movements
       (organization_id, location_id, batch_id, variant_id, product_id, sku, item_name, movement_type, quantity,
        on_hand_after, unit_cost, source_type, source_id, source_line_id, reason, note, actor_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'opening', ?, ?, NULL, 'product', ?, ?, ?, 'Cost unknown.', 'Storefront')`,
    [
      organizationId,
      locationId,
      batchId,
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
  const rows = await exec(
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
 * (Same rule as ecom_erp's stock_availability view and online_available(): a lot is
 * expired once its date is before the store's business date, business_today(),
 * migration 079 — through its printed date it is still sellable.)
 */
const EXPIRED_UNSWEPT = `COALESCE((
  SELECT SUM(ll.on_hand)
    FROM stock_lot_levels ll
    JOIN stock_lots lt ON lt.id = ll.lot_id AND lt.organization_id = ll.organization_id
   WHERE ll.organization_id = sl.organization_id AND ll.location_id = sl.location_id AND ll.variant_id = sl.variant_id
     AND lt.expiry_date IS NOT NULL AND lt.expiry_date < business_today(lt.organization_id)
), 0)`;

/**
 * Locations that may fill an online order, best first: active and marked
 * `fulfils_online`. The status of a location's branch does not make it
 * ineligible — the order is taken, and is saved with no fulfilment branch when
 * that branch is not active (see branchOfLocation). Ties on priority fall to
 * name, so the choice is repeatable.
 */
async function eligibleLocations(conn, source) {
  if (source.locationId) {
    // The chosen source, and only if it can still take orders. Never a fallback
    // to another store: the website promised this one's stock.
    return exec(
      conn,
      `SELECT l.id, l.name, l.branch_id AS branchId
         FROM stock_locations l
        WHERE l.organization_id = ? AND l.id = ? AND l.status = 'Active' AND l.fulfils_online = 1 AND l.parent_location_id IS NULL`,
      [getOrganizationId(), source.locationId],
    );
  }
  return exec(
    conn,
    `SELECT l.id, l.name, l.branch_id AS branchId
       FROM stock_locations l
      WHERE l.organization_id = ? AND l.status = 'Active' AND l.fulfils_online = 1
      ORDER BY l.fulfilment_priority IS NULL, l.fulfilment_priority, l.name, l.id`,
    [getOrganizationId()],
  );
}

/** Run on the transaction's connection when there is one, else on the pool (a quote reads, locks nothing). */
const exec = (conn, sql, params) => (conn ? run(conn, sql, params) : query(sql, params));

/**
 * A variant's sellable, unexpired batches at one location with something available, in
 * ALLOCATION ORDER: oldest received first; for an item tracked by lot or expiry, earliest
 * expiry first (no expiry last) then oldest received; ties by batch id. With a connection the rows
 * are read FOR UPDATE, so a checkout that plans from them and then reserves cannot be
 * overtaken by another checkout or a till sale. Same order as the dashboard's engine.
 */
async function loadBatches(conn, locationId, variantId, tracking, { lock = false } = {}) {
  const fefo = tracking === "lot" || tracking === "expiry";
  const rows = await exec(
    conn,
    `SELECT bl.batch_id AS batchId, bl.quantity - bl.reserved AS available, b.selling_price AS sellingPrice, b.unit_cost AS unitCost,
            b.lot_id AS lotId, lt.expiry_date AS expiryDate,
            (lt.expiry_date IS NOT NULL AND lt.expiry_date < business_today(b.organization_id)) AS expired
       FROM stock_batch_levels bl
       JOIN stock_batches b ON b.id = bl.batch_id AND b.organization_id = bl.organization_id
       LEFT JOIN stock_lots lt ON lt.id = b.lot_id AND lt.organization_id = b.organization_id
      WHERE bl.organization_id = ? AND bl.location_id = ? AND bl.variant_id = ? AND bl.item_condition = 'sellable' AND bl.quantity > 0
      ORDER BY ${fefo ? "(lt.expiry_date IS NULL), lt.expiry_date, " : ""}b.received_at, b.created_at, b.id
      ${lock ? "FOR UPDATE" : ""}`,
    [getOrganizationId(), locationId, variantId],
  );
  return rows.filter((r) => !Number(r.expired) && Number(r.available) > 0);
}

/**
 * Lay `quantity` of one variant over the batches in order. `taken` (batchId → quantity) carries
 * what earlier lines of the same order already claimed. Returns { segments, shortfall }.
 */
function planSegments(rows, quantity, taken) {
  let left = Number(quantity);
  const segments = [];
  for (const row of rows) {
    if (left <= 0) break;
    const free = Math.round((Number(row.available) - (taken.get(row.batchId) ?? 0)) * 1000) / 1000;
    if (free <= 0) continue;
    const take = Math.min(free, left);
    segments.push({ batchId: row.batchId, quantity: take, sellingPrice: Number(row.sellingPrice), unitCost: row.unitCost == null ? null : Number(row.unitCost) });
    taken.set(row.batchId, (taken.get(row.batchId) ?? 0) + take);
    left = Math.round((left - take) * 1000) / 1000;
  }
  return { segments, shortfall: left };
}

/**
 * Decide where an order's lines come from and which batches fill them, WITHOUT reserving.
 *
 * `lines`: [{ variantId, productId, quantity, tracking, sku }]. Returns
 * { locationId, branchId, lines: [{ ...line, segments: [{ batchId, quantity, sellingPrice, unitCost }] }] }
 * for the first eligible location that covers the whole order (the chosen Product Source Store is the only
 * candidate when there is one). Throws InsufficientStockError — carrying the variant and what IS available —
 * when none can.
 *
 * With a connection (checkout) the chosen store is read in share mode and the batch rows FOR UPDATE: the plan
 * is then a promise the same transaction keeps by reserving exactly those segments. Without one (a quote) it
 * is a plain read, good for showing the shopper what checkout would make.
 */
export async function planOrder(conn, lines) {
  const organizationId = getOrganizationId();
  const source = await getOnlineSource(conn);
  const candidates = await eligibleLocations(conn, source);
  if (!candidates.length) {
    throw new InsufficientStockError(
      source.locationId
        ? "The store that supplies this website cannot take orders right now. Please try again shortly."
        : "This store has no location set up to fill online orders yet, so it cannot take orders.",
    );
  }
  // If the store switched sources or dropped an item since the shopper's items were checked, say so rather
  // than plan something this source no longer offers.
  if (source.locationId) {
    for (const line of lines) {
      const [row] = await exec(conn, "SELECT online_offered(?, ?) AS offered", [organizationId, line.variantId]);
      if (!Number(row?.offered)) {
        throw new InsufficientStockError(`${line.sku || "An item"} is no longer offered online`, { variantId: line.variantId });
      }
    }
  }

  // Fixed order, so two checkouts planning the same items cannot deadlock on the batch rows.
  const order = lines.map((line, index) => ({ line, index })).sort((a, b) => String(a.line.variantId).localeCompare(String(b.line.variantId)) || a.index - b.index);
  let firstShortage = null;
  for (const location of candidates) {
    const rowsByVariant = new Map();
    const taken = new Map();
    const planned = new Array(lines.length);
    let covered = true;
    for (const { line, index } of order) {
      if (!rowsByVariant.has(line.variantId)) {
        rowsByVariant.set(line.variantId, await loadBatches(conn, location.id, line.variantId, line.tracking, { lock: Boolean(conn) }));
      }
      const { segments, shortfall } = planSegments(rowsByVariant.get(line.variantId), line.quantity, taken);
      if (shortfall > 0) {
        covered = false;
        firstShortage ??= { line, available: Number(line.quantity) - shortfall };
        break;
      }
      planned[index] = { ...line, segments };
    }
    if (covered) {
      return { locationId: location.id, branchId: await branchOfLocation(conn, location.id), lines: planned };
    }
  }
  throw new InsufficientStockError(
    `Insufficient stock for ${firstShortage?.line.sku || "an item"}` + (candidates.length > 1 ? " — no single location can supply this whole order" : ""),
    { variantId: firstShortage?.line.variantId, available: firstShortage?.available ?? 0 },
  );
}

/**
 * Reserve a plan inside the order's transaction: one reservation per order line, each holding exactly the
 * batches the plan named, with the price quoted and the cost as it stands (provisional). Each batch is a
 * guarded UPDATE of `reserved`, so a unit another request took in the meantime fails the whole order (the
 * caller rolls back) rather than being quietly moved to another batch at another price.
 *
 * `plan.lines[i].orderItemId` names the order line it promises stock to; the unique key on order_item_id
 * makes a second reservation for the same line impossible.
 *
 * The same location that backs the reservations decides the order's fulfilment branch (`orders.branch_id`),
 * written in this same transaction — not a second lookup of "the default". The assignment is a fact about this
 * order: changing the default location later does not move it. A location with no valid branch leaves the
 * order explicitly unassigned (branch_id NULL); the dashboard reports those.
 *
 * Returns { locationId, branchId } (branchId null when unassigned).
 */
export async function reserveOrder(conn, orderId, plan) {
  const organizationId = getOrganizationId();
  for (const line of plan.lines) {
    const reservationId = newId("rsv");
    await run(
      conn,
      `INSERT INTO stock_reservations
         (id, organization_id, location_id, order_id, order_item_id, variant_id, product_id, quantity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [reservationId, organizationId, plan.locationId, orderId, line.orderItemId, line.variantId, line.productId, line.quantity],
    );
    for (const seg of line.segments) {
      const [result] = await conn.query(
        `UPDATE stock_batch_levels SET reserved = reserved + ?
          WHERE organization_id = ? AND location_id = ? AND batch_id = ? AND item_condition = 'sellable' AND quantity - reserved >= ?`,
        [seg.quantity, organizationId, plan.locationId, seg.batchId, seg.quantity],
      );
      if (result.affectedRows !== 1) {
        throw new InsufficientStockError(`Insufficient stock for ${line.sku || "an item"}`, { variantId: line.variantId });
      }
      await run(
        conn,
        `INSERT INTO stock_batch_allocations
           (organization_id, batch_id, location_id, variant_id, holder_type, holder_id, quantity, status, unit_price, unit_cost, cost_state)
         VALUES (?, ?, ?, ?, 'order_reservation', ?, ?, 'active', ?, ?, 'provisional')`,
        [organizationId, seg.batchId, plan.locationId, line.variantId, reservationId, seg.quantity, seg.sellingPrice, seg.unitCost],
      );
    }
  }

  const branchId = await branchOfLocation(conn, plan.locationId);
  if (branchId) {
    await run(conn, "UPDATE orders SET branch_id = ? WHERE organization_id = ? AND id = ? AND branch_id IS NULL", [branchId, organizationId, orderId]);
  }
  return { locationId: plan.locationId, branchId };
}

/**
 * Release an order's active reservations — the order will not ship. Locked rows first, so a concurrent
 * dispatch in the dashboard and this cancel serialise; a reservation already consumed (dispatched) is left
 * alone. Every batch the reservation held gives its units back (reserved drops; nothing physical moves), and
 * the allocation is marked released — once.
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
    const allocations = await run(
      conn,
      `SELECT id, batch_id, location_id, quantity FROM stock_batch_allocations
        WHERE organization_id = ? AND holder_type = 'order_reservation' AND holder_id = ? AND status = 'active'
        ORDER BY id FOR UPDATE`,
      [organizationId, r.id],
    );
    if (!allocations.length) {
      throw new Error(`Reservation ${r.id} could not be released: it holds no batch stock`);
    }
    for (const a of allocations) {
      const [result] = await conn.query(
        `UPDATE stock_batch_levels SET reserved = reserved - ?
          WHERE organization_id = ? AND location_id = ? AND batch_id = ? AND item_condition = 'sellable' AND reserved >= ?`,
        [a.quantity, organizationId, a.location_id, a.batch_id, a.quantity],
      );
      if (result.affectedRows !== 1) {
        throw new Error(`Reservation ${r.id} could not be released: its reserved stock is missing`);
      }
      await run(
        conn,
        `UPDATE stock_batch_allocations SET status = 'released', resolved_at = NOW(3), resolved_reason = ?
          WHERE id = ? AND status = 'active'`,
        [String(reason || "").slice(0, 120), a.id],
      );
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
  const source = await getOnlineSource();
  const rows = await query(
    `SELECT GREATEST(sl.on_hand - sl.reserved - ${EXPIRED_UNSWEPT}, 0) AS available, sl.reorder_point AS reorderPoint
       FROM stock_levels sl
       JOIN stock_locations l ON l.id = sl.location_id AND l.organization_id = sl.organization_id
      WHERE sl.organization_id = ? AND sl.variant_id = ? AND l.status = 'Active' AND l.fulfils_online = 1
        AND (? IS NULL OR l.id = ?)
      ORDER BY available DESC, l.fulfilment_priority IS NULL, l.fulfilment_priority
      LIMIT 1`,
    [getOrganizationId(), variantId, source.locationId, source.locationId],
  );
  return rows[0] ?? null;
}
