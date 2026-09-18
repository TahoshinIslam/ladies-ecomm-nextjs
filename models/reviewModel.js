import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import User from "./userModel.js";
import Product from "./productModel.js";

function rowToReview(row, user, repliedBy) {
  if (!row) return null;
  const review = {
    _id: row.id,
    user: user ?? row.user_id,
    product: row.product_id,
    rating: row.rating,
    // "" and "not provided" are indistinguishable in the DB (title is
    // NOT NULL DEFAULT '', and the create()/schema layer reject an explicit
    // empty string — see schemas/reviewSchemas.js), so an empty value here
    // always means omitted; surface it as undefined to match the old
    // Mongoose-level optional-field representation the frontend expects.
    title: row.title || undefined,
    comment: row.comment,
    isVerifiedPurchase: !!row.is_verified_purchase,
    images: typeof row.images === "string" ? JSON.parse(row.images) : row.images || [],
    helpfulCount: row.helpful_count,
    adminReply: {
      text: row.admin_reply_text || "",
      repliedBy: repliedBy ?? row.admin_reply_by,
      repliedAt: row.admin_reply_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  review.save = async function save() {
    return saveReview(this);
  };
  review.deleteOne = async function deleteOne() {
    await query("DELETE FROM reviews WHERE id = ?", [this._id]);
  };
  return review;
}

async function populateOne(row, { populateUser = false, populateReplier = false } = {}) {
  const user = populateUser ? await userSummary(row.user_id) : undefined;
  const repliedBy = populateReplier && row.admin_reply_by ? await userSummary(row.admin_reply_by) : undefined;
  return rowToReview(row, user, repliedBy);
}

async function userSummary(id, fields = ["name", "avatar"]) {
  const u = await User.findById(id);
  if (!u) return null;
  const out = { _id: u._id };
  for (const f of fields) out[f] = u[f];
  return out;
}

/** Recalculates and persists a product's aggregate rating/numReviews — the SQL port of the old post("save")/post("deleteOne") hooks. */
async function recalcProductRating(productId) {
  const rows = await query("SELECT AVG(rating) AS avg_rating, COUNT(*) AS n FROM reviews WHERE product_id = ?", [productId]);
  const avgRating = rows[0].n > 0 ? Math.round(Number(rows[0].avg_rating) * 10) / 10 : 0;
  await query("UPDATE products SET rating = ?, num_reviews = ? WHERE id = ?", [avgRating, rows[0].n, productId]);
}

async function findById(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM reviews WHERE id = ?", [id]);
  return populateOne(rows[0]);
}

async function findByProduct(productId, { skip = 0, limit = 10 } = {}) {
  const rows = await query(
    "SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [productId, Number(limit), Number(skip)],
  );
  return Promise.all(rows.map((r) => populateOne(r, { populateUser: true, populateReplier: true })));
}

async function countByProduct(productId) {
  const rows = await query("SELECT COUNT(*) AS n FROM reviews WHERE product_id = ?", [productId]);
  return rows[0].n;
}

async function ratingBreakdown(productId) {
  const rows = await query("SELECT rating, COUNT(*) AS count FROM reviews WHERE product_id = ? GROUP BY rating", [productId]);
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of rows) {
    if (r.rating >= 1 && r.rating <= 5) breakdown[r.rating] = r.count;
  }
  return breakdown;
}

async function findByUserAndProducts(userId, productIds) {
  if (!productIds.length) return [];
  const rows = await query(
    `SELECT * FROM reviews WHERE user_id = ? AND product_id IN (${productIds.map(() => "?").join(",")})`,
    [userId, ...productIds],
  );
  return Promise.all(rows.map((r) => populateOne(r, { populateUser: true, populateReplier: true })));
}

// Lets a genuine ER_DUP_ENTRY (from the reviews.uq_reviews_user_product
// unique index) propagate as-is instead of translating it into a
// MongoDB-shaped `{code: 11000}` error — that translation was Mongo-era
// compatibility scaffolding for reviewService.js, which now checks the
// real MySQL error directly via lib/idempotency.js's isDuplicateKeyError(),
// the same helper every other duplicate-key path in this codebase uses.
async function create({ user, product, rating, title, comment, images, isVerifiedPurchase }) {
  const id = generateObjectId();
  await query(
    "INSERT INTO reviews (id, user_id, product_id, rating, title, comment, images, is_verified_purchase, admin_reply_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, user, product, rating, title || "", comment, JSON.stringify(images || []), isVerifiedPurchase ? 1 : 0, ""],
  );
  await recalcProductRating(product);
  return findById(id);
}

async function saveReview(review) {
  await query(
    "UPDATE reviews SET rating=?, title=?, comment=?, images=?, admin_reply_text=?, admin_reply_by=?, admin_reply_at=? WHERE id=?",
    [
      review.rating,
      review.title || "",
      review.comment,
      JSON.stringify(review.images || []),
      review.adminReply?.text || "",
      review.adminReply?.repliedBy ?? null,
      review.adminReply?.repliedAt ?? null,
      review._id,
    ],
  );
  return review;
}

const REVIEW_SORT_COLUMNS = { createdAt: "created_at", rating: "rating", helpfulCount: "helpful_count" };

async function findAdminList({ rating, productId, search, sortBy, sortOrder, skip, limit }) {
  const clauses = [];
  const params = [];
  if (rating) {
    clauses.push("rating = ?");
    params.push(Number(rating));
  }
  if (productId) {
    clauses.push("product_id = ?");
    params.push(productId);
  }
  if (search) {
    clauses.push("(comment LIKE ? OR title LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = clauses.length ? clauses.join(" AND ") : "1=1";
  const sortCol = REVIEW_SORT_COLUMNS[sortBy] || "created_at";
  const sortDir = sortOrder === "asc" ? "ASC" : "DESC";

  const rows = await query(`SELECT * FROM reviews WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`, [
    ...params,
    Number(limit),
    Number(skip),
  ]);
  const totalRows = await query(`SELECT COUNT(*) AS n FROM reviews WHERE ${where}`, params);

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const products = productIds.length ? await Product.findByIds(productIds) : [];
  const productById = new Map(products.map((p) => [p._id, { _id: p._id, name: p.name, images: p.images, slug: p.slug }]));

  const reviews = await Promise.all(
    rows.map(async (r) => {
      const review = await populateOne(r, { populateUser: true, populateReplier: true });
      review.user = await userSummary(r.user_id, ["name", "email", "avatar"]);
      review.product = productById.get(r.product_id) || r.product_id;
      return review;
    }),
  );

  return { reviews, total: totalRows[0].n };
}

const Review = {
  findById,
  findByProduct,
  countByProduct,
  ratingBreakdown,
  findByUserAndProducts,
  create,
  findAdminList,
};

export default Review;
