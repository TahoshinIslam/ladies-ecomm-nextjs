import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

function rowToUsage(row) {
  if (!row) return null;
  return { _id: row.id, coupon: row.coupon_id, user: row.user_id, count: row.count };
}

async function findByCouponUser(couponId, userId, conn) {
  const sql = "SELECT * FROM coupon_usages WHERE coupon_id = ? AND user_id = ?";
  const rows = conn ? (await conn.query(sql, [couponId, userId]))[0] : await query(sql, [couponId, userId]);
  return rowToUsage(rows[0]);
}

/**
 * Atomic, guarded per-user claim inside an order-creation transaction —
 * mirrors the old guarded upsert (`findOneAndUpdate({coupon,user,count:{$lt:
 * perUserLimit}}, {$inc}, {upsert:true})`). `SELECT ... FOR UPDATE` locks
 * any existing row for this (coupon, user) pair for the rest of the caller's
 * transaction, so two concurrent claims can never both read the same
 * "not yet at limit" count and both proceed — the second one blocks until
 * the first commits or rolls back, exactly the serialization the old
 * duplicate-key-catch upsert achieved via a different mechanism. Returns
 * true only when THIS call actually advanced the count.
 */
async function claimPerUserUsage(conn, couponId, userId, perUserLimit) {
  const [existingRows] = await conn.query(
    "SELECT count FROM coupon_usages WHERE coupon_id = ? AND user_id = ? FOR UPDATE",
    [couponId, userId],
  );

  if (!existingRows.length) {
    await conn.query("INSERT INTO coupon_usages (id, coupon_id, user_id, count) VALUES (?, ?, ?, 1)", [
      generateObjectId(),
      couponId,
      userId,
    ]);
    return true;
  }

  if (perUserLimit != null && existingRows[0].count >= perUserLimit) {
    return false;
  }
  await conn.query("UPDATE coupon_usages SET count = count + 1 WHERE coupon_id = ? AND user_id = ?", [couponId, userId]);
  return true;
}

/** Reverses claimPerUserUsage() on order cancellation. */
async function restorePerUserUsage(conn, couponId, userId) {
  await conn.query(
    "UPDATE coupon_usages SET count = count - 1 WHERE coupon_id = ? AND user_id = ? AND count > 0",
    [couponId, userId],
  );
}

const CouponUsage = { findByCouponUser, claimPerUserUsage, restorePerUserUsage };

export default CouponUsage;
