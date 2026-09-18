import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import Product from "./productModel.js";

async function loadProductIds(wishlistId) {
  const rows = await query("SELECT product_id FROM wishlist_items WHERE wishlist_id = ? ORDER BY added_at ASC", [wishlistId]);
  return rows.map((r) => r.product_id);
}

function rowToWishlist(row, productIds) {
  if (!row) return null;
  const wl = {
    _id: row.id,
    user: row.user_id,
    products: productIds || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  wl.save = async function save() {
    return saveWishlist(this);
  };
  return wl;
}

async function findByUser(userId) {
  const rows = await query("SELECT * FROM wishlists WHERE user_id = ?", [userId]);
  if (!rows.length) return null;
  return rowToWishlist(rows[0], await loadProductIds(rows[0].id));
}

async function create(userId) {
  const id = generateObjectId();
  await query("INSERT INTO wishlists (id, user_id) VALUES (?, ?)", [id, userId]);
  return rowToWishlist({ id, user_id: userId, created_at: new Date(), updated_at: new Date() }, []);
}

/** Replaces the product-id list wholesale — matches how services/wishlistService.js mutates `wl.products` in memory before calling save(). */
async function saveWishlist(wl) {
  await withConnection(async (conn) => {
    await conn.query("DELETE FROM wishlist_items WHERE wishlist_id = ?", [wl._id]);
    for (const productId of wl.products) {
      await conn.query("INSERT INTO wishlist_items (wishlist_id, product_id) VALUES (?, ?)", [wl._id, productId]);
    }
    await conn.query("UPDATE wishlists SET updated_at = NOW(3) WHERE id = ?", [wl._id]);
  });
  return wl;
}

/** Populated form: the wishlist's product ids resolved to full product rows, in save order. */
async function populate(wl) {
  const products = wl.products.length ? await Product.findByIds(wl.products) : [];
  const byId = new Map(products.map((p) => [p._id, p]));
  return { ...wl, products: wl.products.map((id) => byId.get(id)).filter(Boolean) };
}

const Wishlist = { findByUser, create, populate };

export default Wishlist;
