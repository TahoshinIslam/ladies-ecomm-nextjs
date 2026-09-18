import { query } from "../config/db.js";

const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];
const revenueStatusPlaceholders = () => REVENUE_STATUSES.map(() => "?").join(",");

export async function getOverview() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalOrdersRows,
    totalRevenueRows,
    monthlyRevenueRows,
    totalUsersRows,
    newUsers30Rows,
    totalProductsRows,
    outOfStockRows,
    pendingOrdersRows,
    avgRatingRows,
  ] = await Promise.all([
    query("SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('cancelled', 'refunded')"),
    query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status IN (${revenueStatusPlaceholders()})`, REVENUE_STATUSES),
    query(
      `SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status IN (${revenueStatusPlaceholders()}) AND created_at >= ?`,
      [...REVENUE_STATUSES, startOfMonth],
    ),
    query("SELECT COUNT(*) AS n FROM users"),
    query("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", [last30]),
    query("SELECT COUNT(*) AS n FROM products WHERE is_active = 1"),
    // A product is out of stock when every one of its variants has stock 0
    // (real schema: product_variants.stock, not the old sneaker-era
    // sizes[].stock) — a product with zero variant rows counts as 0 total
    // stock too, matching the old `$sum: "$variants.stock" == 0` check.
    query(
      `SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1
       AND COALESCE((SELECT SUM(pv.stock) FROM product_variants pv WHERE pv.product_id = p.id), 0) = 0`,
    ),
    query("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
    query("SELECT AVG(rating) AS avg FROM reviews"),
  ]);

  return {
    totalOrders: totalOrdersRows[0].n,
    pendingOrders: pendingOrdersRows[0].n,
    totalRevenue: Number(totalRevenueRows[0].total) || 0,
    monthlyRevenue: Number(monthlyRevenueRows[0].total) || 0,
    totalUsers: totalUsersRows[0].n,
    newUsersLast30: newUsers30Rows[0].n,
    totalProducts: totalProductsRows[0].n,
    outOfStockProducts: outOfStockRows[0].n,
    avgRating: Math.round((Number(avgRatingRows[0].avg) || 0) * 10) / 10,
  };
}

export async function getSalesSeries(days = 30) {
  const clamped = Math.min(365, Math.max(1, Number(days) || 30));
  const since = new Date(Date.now() - clamped * 24 * 60 * 60 * 1000);

  const rows = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
     FROM orders
     WHERE created_at >= ? AND status IN (${revenueStatusPlaceholders()})
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
     ORDER BY date ASC`,
    [since, ...REVENUE_STATUSES],
  );

  return { days: clamped, series: rows.map((r) => ({ date: r.date, revenue: Number(r.revenue), orders: r.orders })) };
}

export async function getTopProducts(limit = 10) {
  const clamped = Math.min(50, Number(limit) || 10);

  const rows = await query(
    `SELECT oi.product_id AS _id,
            SUBSTRING_INDEX(GROUP_CONCAT(oi.snapshot_name ORDER BY o.created_at DESC SEPARATOR ''), '', 1) AS name,
            SUBSTRING_INDEX(GROUP_CONCAT(oi.snapshot_image ORDER BY o.created_at DESC SEPARATOR ''), '', 1) AS image,
            SUM(oi.quantity) AS totalSold,
            SUM(oi.snapshot_price * oi.quantity) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status IN (${revenueStatusPlaceholders()})
     GROUP BY oi.product_id
     ORDER BY totalSold DESC
     LIMIT ?`,
    [...REVENUE_STATUSES, clamped],
  );

  return rows.map((r) => ({ _id: r._id, name: r.name, image: r.image, totalSold: r.totalSold, revenue: Number(r.revenue) }));
}

export async function getStatusBreakdown() {
  const rows = await query("SELECT status, COUNT(*) AS count FROM orders GROUP BY status");
  return rows.map((r) => ({ status: r.status, count: r.count }));
}

export async function getRevenueByMethod() {
  const rows = await query(
    `SELECT COALESCE(p.method, 'unknown') AS method, SUM(o.total) AS revenue, COUNT(*) AS count
     FROM orders o LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.status IN (${revenueStatusPlaceholders()})
     GROUP BY COALESCE(p.method, 'unknown')`,
    REVENUE_STATUSES,
  );
  return rows.map((r) => ({ method: r.method, revenue: Number(r.revenue), count: r.count }));
}
