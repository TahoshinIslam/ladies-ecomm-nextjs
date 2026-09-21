import { query } from "../config/db.js";
import { getOrganizationId } from "../lib/tenant.js";

const DEFAULT_HOMEPAGE = {
  carouselImages: { burqa: "", abaya: "", hijab: "", khimar: "" },
  departmentImages: { burqa: "", abaya: "", hijab: "", niqab: "", khimar: "", "modest-sets": "" },
  fabricImages: { nida: "", crepe: "", chiffon: "", jersey: "", georgette: "" },
  occasionImages: { eid: "", everyday: "", bridal: "", prayer: "" },
  guidedFinderImage: "",
  occasionMenuImage: "",
  banner: { enabled: false, imageUrl: "", href: "" },
  campaign: { enabled: false, title: "", message: "", ctaLabel: "", ctaHref: "" },
};
const DEFAULT_CURRENCY = { defaultDisplay: "BDT", usdToBdt: 120 };
const DEFAULT_PROMOTIONS = { firstOrderFreeShipping: false };
const DEFAULT_EXCHANGE_POLICY = { windowDays: 14, description: "Easy exchanges" };
const DEFAULT_TAX_RULES = [
  { region: "BD", label: "VAT", rate: 0.15, inclusive: true },
  { region: "INTL", label: "No tax", rate: 0, inclusive: false },
];
// BDT-only currency migration: the INTL zone's tier is now BDT-denominated
// too (3000/24000 = the same real-world $25/$200 figures, converted at the
// 120 rate) — every charge this app produces is BDT, including
// international shipping; see docs/CURRENCY_MIGRATION_PLAN.md.
const DEFAULT_SHIPPING_ZONES = [
  { region: "BD", currency: "BDT", tiers: [{ name: "Inside Dhaka", baseCost: 60, freeAbove: 2000 }, { name: "Outside Dhaka", baseCost: 120, freeAbove: 2000 }] },
  { region: "INTL", currency: "BDT", tiers: [{ name: "Standard", baseCost: 3000, freeAbove: 24000 }] },
];

function jsonOrDefault(value, fallback) {
  if (value == null) return fallback;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function rowToSettings(row) {
  if (!row) return null;
  const settings = {
    _id: row.organization_id,
    store: {
      name: row.store_name,
      supportEmail: row.store_support_email,
      supportPhone: row.store_support_phone,
      logoUrl: row.store_logo_url,
      logoDarkUrl: row.store_logo_dark_url,
      faviconUrl: row.store_favicon_url,
    },
    homepage: jsonOrDefault(row.homepage, DEFAULT_HOMEPAGE),
    currency: jsonOrDefault(row.currency, DEFAULT_CURRENCY),
    promotions: jsonOrDefault(row.promotions, DEFAULT_PROMOTIONS),
    exchangePolicy: jsonOrDefault(row.exchange_policy, DEFAULT_EXCHANGE_POLICY),
    taxRules: jsonOrDefault(row.tax_rules, DEFAULT_TAX_RULES),
    shippingZones: jsonOrDefault(row.shipping_zones, DEFAULT_SHIPPING_ZONES),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  settings.save = async function save() {
    return saveSettings(this);
  };
  return settings;
}

async function saveSettings(settings) {
  await query(
    `UPDATE store_settings SET store_name=?, store_support_email=?, store_support_phone=?, store_logo_url=?,
       store_logo_dark_url=?, store_favicon_url=?, homepage=?, currency=?, promotions=?, exchange_policy=?,
       tax_rules=?, shipping_zones=? WHERE organization_id=?`,
    [
      settings.store.name,
      settings.store.supportEmail || "",
      settings.store.supportPhone || "",
      settings.store.logoUrl || "",
      settings.store.logoDarkUrl || "",
      settings.store.faviconUrl || "",
      JSON.stringify(settings.homepage),
      JSON.stringify(settings.currency),
      JSON.stringify(settings.promotions),
      JSON.stringify(settings.exchangePolicy),
      JSON.stringify(settings.taxRules),
      JSON.stringify(settings.shippingZones),
      settings._id,
    ],
  );
  return settings;
}

/**
 * This store's settings row.
 *
 * Was `WHERE id = 'main'` — one row for one shop. In the shared database the
 * table is keyed by organization instead and there is no `id` column at all,
 * so "the singleton" now means "this organization's row": still exactly one,
 * but one per store rather than one per database.
 */
async function getSingleton() {
  const organizationId = getOrganizationId();

  const rows = await query("SELECT * FROM store_settings WHERE organization_id = ?", [organizationId]);
  if (rows.length) return rowToSettings(rows[0]);

  // A store with no settings row yet gets the defaults written for it. The
  // dashboard may be creating the same row at the same moment, so this
  // tolerates losing that race rather than failing the request.
  await query(
    `INSERT IGNORE INTO store_settings
       (organization_id, homepage, currency, promotions, exchange_policy, tax_rules, shipping_zones)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      organizationId,
      JSON.stringify(DEFAULT_HOMEPAGE),
      JSON.stringify(DEFAULT_CURRENCY),
      JSON.stringify(DEFAULT_PROMOTIONS),
      JSON.stringify(DEFAULT_EXCHANGE_POLICY),
      JSON.stringify(DEFAULT_TAX_RULES),
      JSON.stringify(DEFAULT_SHIPPING_ZONES),
    ],
  );
  const created = await query("SELECT * FROM store_settings WHERE organization_id = ?", [organizationId]);
  return rowToSettings(created[0]);
}

const Settings = { getSingleton };

export default Settings;
