import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

const DEFAULT_COLORS = {
  primary: "#111111", primaryForeground: "#ffffff", accent: "#f97316", accentForeground: "#ffffff",
  background: "#ffffff", foreground: "#0a0a0a", muted: "#f5f5f5", mutedForeground: "#737373",
  border: "#e5e5e5", success: "#10b981", warning: "#f59e0b", danger: "#ef4444",
};
const DEFAULT_DARK_COLORS = {
  primary: "#fafafa", primaryForeground: "#0a0a0a", accent: "#fb923c", accentForeground: "#0a0a0a",
  background: "#0a0a0a", foreground: "#fafafa", muted: "#262626", mutedForeground: "#a3a3a3",
  border: "#262626", success: "#34d399", warning: "#fbbf24", danger: "#f87171",
};
const DEFAULT_FONTS = { heading: "Inter, system-ui, sans-serif", body: "Inter, system-ui, sans-serif" };
const DEFAULT_FEATURES = {
  enableDarkMode: true, enableAnimations: true, enableWishlist: true, enableCompare: true,
  enableReviews: true, enableCoupons: true, announcementBar: "",
};

function jsonOrDefault(value, fallback) {
  if (value == null) return fallback;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function rowToTheme(row) {
  if (!row) return null;
  const theme = {
    _id: row.id,
    name: row.name,
    isActive: !!row.is_active,
    colors: { ...DEFAULT_COLORS, ...jsonOrDefault(row.colors, {}) },
    darkColors: { ...DEFAULT_DARK_COLORS, ...jsonOrDefault(row.dark_colors, {}) },
    fonts: { ...DEFAULT_FONTS, ...jsonOrDefault(row.fonts, {}) },
    radius: row.radius,
    shadowStyle: row.shadow_style,
    density: row.density,
    logoUrl: row.logo_url,
    logoDarkUrl: row.logo_dark_url,
    faviconUrl: row.favicon_url,
    siteName: row.site_name,
    tagline: row.tagline,
    features: { ...DEFAULT_FEATURES, ...jsonOrDefault(row.features, {}) },
    updatedBy: row.updated_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  theme.save = async function save() {
    return saveTheme(this);
  };
  theme.deleteOne = async function deleteOne() {
    // Soft delete, matching how the dashboard removes a theme. A hard DELETE
    // would work and be simpler, but the two applications share this table:
    // one removing rows outright while the other marks them would make
    // "deleted" mean two different things depending on who did it.
    await query(
      "UPDATE storefront_themes SET deleted_at = NOW(3) WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
      [getOrganizationId(), this._id],
    );
  };
  return theme;
}

async function findById(id) {
  if (!id) return null;
  const rows = await query(
    "SELECT * FROM storefront_themes WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id],
  );
  return rowToTheme(rows[0]);
}

async function findActive() {
  const rows = await query(
    "SELECT * FROM storefront_themes WHERE organization_id = ? AND deleted_at IS NULL AND is_active = 1 LIMIT 1",
    [getOrganizationId()],
  );
  return rowToTheme(rows[0]);
}

async function findByName(name) {
  const rows = await query(
    "SELECT * FROM storefront_themes WHERE organization_id = ? AND name = ? AND deleted_at IS NULL",
    [getOrganizationId(), name],
  );
  return rowToTheme(rows[0]);
}

async function findAll() {
  const rows = await query(
    `SELECT * FROM storefront_themes
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY is_active DESC, created_at DESC`,
    [getOrganizationId()],
  );
  return rows.map(rowToTheme);
}

/**
 * Only one theme is active at a time — for THIS store.
 *
 * Unscoped this was the most destructive statement in the model: activating
 * a theme would have switched off the active theme of every other shop in
 * the database, and each of them would have rendered with defaults until
 * someone noticed.
 */
async function deactivateAllExcept(conn, id) {
  await conn.query(
    "UPDATE storefront_themes SET is_active = 0 WHERE organization_id = ? AND id != ?",
    [getOrganizationId(), id || ""],
  );
}

async function create(data) {
  const id = generateObjectId();
  await withConnection(async (conn) => {
    if (data.isActive) await deactivateAllExcept(conn, id);
    await conn.query(
      `INSERT INTO storefront_themes (id, organization_id, name, is_active, colors, dark_colors, fonts, radius,
         shadow_style, density, logo_url, logo_dark_url, favicon_url, site_name, tagline, features, updated_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        getOrganizationId(),
        data.name || "Default",
        data.isActive ? 1 : 0,
        JSON.stringify({ ...DEFAULT_COLORS, ...(data.colors || {}) }),
        JSON.stringify({ ...DEFAULT_DARK_COLORS, ...(data.darkColors || {}) }),
        JSON.stringify({ ...DEFAULT_FONTS, ...(data.fonts || {}) }),
        data.radius || "0.75rem",
        data.shadowStyle || "soft",
        data.density || "comfortable",
        data.logoUrl || "",
        data.logoDarkUrl || "",
        data.faviconUrl || "",
        data.siteName || "TAHOS.",
        data.tagline || "Modest fashion, made with intention.",
        JSON.stringify({ ...DEFAULT_FEATURES, ...(data.features || {}) }),
        data.updatedBy || null,
      ],
    );
  });
  return findById(id);
}

async function saveTheme(theme) {
  await withConnection(async (conn) => {
    if (theme.isActive) await deactivateAllExcept(conn, theme._id);
    await conn.query(
      `UPDATE storefront_themes SET name=?, is_active=?, colors=?, dark_colors=?, fonts=?, radius=?, shadow_style=?,
         density=?, logo_url=?, logo_dark_url=?, favicon_url=?, site_name=?, tagline=?, features=?, updated_by_id=?
        WHERE organization_id=? AND id=?`,
      [
        theme.name,
        theme.isActive ? 1 : 0,
        JSON.stringify(theme.colors),
        JSON.stringify(theme.darkColors),
        JSON.stringify(theme.fonts),
        theme.radius,
        theme.shadowStyle,
        theme.density,
        theme.logoUrl || "",
        theme.logoDarkUrl || "",
        theme.faviconUrl || "",
        theme.siteName || "",
        theme.tagline || "",
        JSON.stringify(theme.features),
        theme.updatedBy || null,
        getOrganizationId(),
        theme._id,
      ],
    );
  });
  return theme;
}

const Theme = { findById, findActive, findByName, findAll, create };

export default Theme;
