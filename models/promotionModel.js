import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { columnExists } from "../lib/columnExists.js";
import { parseFramingColumn } from "../lib/imageFraming.js";

function rowToPromotion(row) {
  if (!row) return null;
  const promotion = {
    _id: row.id,
    name: row.name,
    type: row.type,
    placement: row.placement,
    status: row.status,
    title: row.title,
    titleBn: row.title_bn,
    subtitle: row.subtitle,
    subtitleBn: row.subtitle_bn,
    ctaLabel: row.cta_label,
    ctaLabelBn: row.cta_label_bn,
    desktopImage: row.desktop_image,
    mobileImage: row.mobile_image,
    // null = unframed (the image renders exactly as it did before framing existed).
    // Undefined columns (migration 0006 not applied yet) read as null too.
    desktopFraming: parseFramingColumn(row.desktop_framing),
    mobileFraming: parseFramingColumn(row.mobile_framing),
    imageAlt: row.image_alt,
    imageAltBn: row.image_alt_bn,
    targetType: row.target_type,
    targetProduct: row.target_product_id,
    targetCategory: row.target_category_id,
    targetCollection: row.target_collection,
    targetShopFilter: row.target_shop_filter_category_id || row.target_shop_filter_collection || row.target_shop_filter_style_id
      ? { category: row.target_shop_filter_category_id, collection: row.target_shop_filter_collection, style: row.target_shop_filter_style_id }
      : null,
    targetUrl: row.target_url,
    startAt: row.start_at,
    endAt: row.end_at,
    priority: row.priority,
    sortOrder: row.sort_order,
    audience: row.audience,
    pageScope: row.page_scope,
    popupDelayMs: row.popup_delay_ms,
    frequency: row.frequency,
    cooldownHours: row.cooldown_hours,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  promotion.save = async function save() {
    return savePromotion(this);
  };
  return promotion;
}

async function findById(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM promotions WHERE id = ?", [id]);
  return rowToPromotion(rows[0]);
}

async function findAll({ type, status } = {}) {
  const clauses = [];
  const params = [];
  if (type) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? clauses.join(" AND ") : "1=1";
  const rows = await query(`SELECT * FROM promotions WHERE ${where} ORDER BY sort_order ASC, priority DESC, id ASC`, params);
  return rows.map(rowToPromotion);
}

async function findIdsByType(type) {
  const rows = await query("SELECT id FROM promotions WHERE type = ?", [type]);
  return rows.map((r) => r.id);
}

async function create(data) {
  const id = generateObjectId();
  await query(
    `INSERT INTO promotions
       (id, name, type, placement, status, title, title_bn, subtitle, subtitle_bn, cta_label, cta_label_bn,
        desktop_image, mobile_image, image_alt, image_alt_bn, target_type, target_product_id, target_category_id,
        target_collection, target_shop_filter_category_id, target_shop_filter_collection, target_shop_filter_style_id,
        target_url, start_at, end_at, priority, sort_order, audience, page_scope, popup_delay_ms, frequency,
        cooldown_hours, version, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name,
      data.type,
      data.placement,
      data.status || "draft",
      data.title || "",
      data.titleBn || "",
      data.subtitle || "",
      data.subtitleBn || "",
      data.ctaLabel || "",
      data.ctaLabelBn || "",
      data.desktopImage,
      data.mobileImage || "",
      data.imageAlt || "",
      data.imageAltBn || "",
      data.targetType || "none",
      data.targetProduct || null,
      data.targetCategory || null,
      data.targetCollection || null,
      data.targetShopFilter?.category || null,
      data.targetShopFilter?.collection || null,
      data.targetShopFilter?.style || null,
      data.targetUrl || "",
      data.startAt || null,
      data.endAt || null,
      data.priority ?? 0,
      data.sortOrder ?? 0,
      data.audience || "all",
      data.pageScope || "home",
      data.popupDelayMs ?? 2000,
      data.frequency || "once_per_session",
      data.cooldownHours ?? null,
      data.version ?? 1,
      data.createdBy || null,
      data.updatedBy || null,
    ],
  );
  return findById(id);
}

async function savePromotion(p) {
  await query(
    `UPDATE promotions SET
       name=?, type=?, placement=?, status=?, title=?, title_bn=?, subtitle=?, subtitle_bn=?, cta_label=?, cta_label_bn=?,
       desktop_image=?, mobile_image=?, image_alt=?, image_alt_bn=?, target_type=?, target_product_id=?, target_category_id=?,
       target_collection=?, target_shop_filter_category_id=?, target_shop_filter_collection=?, target_shop_filter_style_id=?,
       target_url=?, start_at=?, end_at=?, priority=?, sort_order=?, audience=?, page_scope=?, popup_delay_ms=?, frequency=?,
       cooldown_hours=?, version=?, updated_by=?
     WHERE id=?`,
    [
      p.name,
      p.type,
      p.placement,
      p.status,
      p.title || "",
      p.titleBn || "",
      p.subtitle || "",
      p.subtitleBn || "",
      p.ctaLabel || "",
      p.ctaLabelBn || "",
      p.desktopImage,
      p.mobileImage || "",
      p.imageAlt || "",
      p.imageAltBn || "",
      p.targetType || "none",
      p.targetProduct || null,
      p.targetCategory || null,
      p.targetCollection || null,
      p.targetShopFilter?.category || null,
      p.targetShopFilter?.collection || null,
      p.targetShopFilter?.style || null,
      p.targetUrl || "",
      p.startAt || null,
      p.endAt || null,
      p.priority ?? 0,
      p.sortOrder ?? 0,
      p.audience || "all",
      p.pageScope || "home",
      p.popupDelayMs ?? 2000,
      p.frequency || "once_per_session",
      p.cooldownHours ?? null,
      p.version ?? 1,
      p.updatedBy || null,
      p._id,
    ],
  );
  return p;
}

async function deleteById(id) {
  const result = await query("DELETE FROM promotions WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

async function updateSortOrder(id, type, sortOrder) {
  await query("UPDATE promotions SET sort_order = ? WHERE id = ? AND type = ?", [sortOrder, id, type]);
}

/** Public eligibility query: matching type/placement/status/pageScope, within schedule bounds. */
async function findEligible({ type, placement, pageScope, now }) {
  const pageScopes = pageScope === "home" ? ["home", "all"] : [pageScope, "all"];
  const sortSql = type === "popup" ? "priority DESC, start_at DESC, id ASC" : "sort_order ASC, priority DESC, id ASC";
  const rows = await query(
    `SELECT * FROM promotions
     WHERE type = ? AND placement = ? AND status = 'active' AND page_scope IN (${pageScopes.map(() => "?").join(",")})
       AND (start_at IS NULL OR start_at <= ?)
       AND (end_at IS NULL OR end_at > ?)
     ORDER BY ${sortSql}`,
    [type, placement, ...pageScopes, now, now],
  );
  return rows.map(rowToPromotion);
}

// Framing lives in its own statement (not in create()/savePromotion()'s big
// column lists) so those keep working unchanged on a database where
// migration 0006_image_framing hasn't been applied yet.
const framingInstalled = () => columnExists("promotions", "desktop_framing");

async function writeFraming(id, desktopFraming, mobileFraming) {
  await query("UPDATE promotions SET desktop_framing = ?, mobile_framing = ? WHERE id = ?", [
    desktopFraming ? JSON.stringify(desktopFraming) : null,
    mobileFraming ? JSON.stringify(mobileFraming) : null,
    id,
  ]);
}

const Promotion = { findById, findAll, findIdsByType, create, deleteById, updateSortOrder, findEligible, framingInstalled, writeFraming };

export default Promotion;
