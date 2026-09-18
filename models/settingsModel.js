import { query } from "../config/db.js";

const DEFAULT_HOMEPAGE = {
  carouselImages: { burqa: "", abaya: "", hijab: "" },
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
const DEFAULT_SHIPPING_ZONES = [
  { region: "BD", currency: "BDT", tiers: [{ name: "Inside Dhaka", baseCost: 60, freeAbove: 2000 }, { name: "Outside Dhaka", baseCost: 120, freeAbove: 2000 }] },
  { region: "INTL", currency: "USD", tiers: [{ name: "Standard", baseCost: 25, freeAbove: 200 }] },
];

function jsonOrDefault(value, fallback) {
  if (value == null) return fallback;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function rowToSettings(row) {
  if (!row) return null;
  const settings = {
    _id: row.id,
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
    `UPDATE settings SET store_name=?, store_support_email=?, store_support_phone=?, store_logo_url=?,
       store_logo_dark_url=?, store_favicon_url=?, homepage=?, currency=?, promotions=?, exchange_policy=?,
       tax_rules=?, shipping_zones=? WHERE id=?`,
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

async function getSingleton() {
  const rows = await query("SELECT * FROM settings WHERE id = 'main'");
  if (rows.length) return rowToSettings(rows[0]);
  await query(
    `INSERT INTO settings (id, homepage, currency, promotions, exchange_policy, tax_rules, shipping_zones)
     VALUES ('main', ?, ?, ?, ?, ?, ?)`,
    [
      JSON.stringify(DEFAULT_HOMEPAGE),
      JSON.stringify(DEFAULT_CURRENCY),
      JSON.stringify(DEFAULT_PROMOTIONS),
      JSON.stringify(DEFAULT_EXCHANGE_POLICY),
      JSON.stringify(DEFAULT_TAX_RULES),
      JSON.stringify(DEFAULT_SHIPPING_ZONES),
    ],
  );
  const rows2 = await query("SELECT * FROM settings WHERE id = 'main'");
  return rowToSettings(rows2[0]);
}

const Settings = { getSingleton };

export default Settings;
