import Settings from "../models/settingsModel.js";

// Public, unauthenticated read — the shape SettingsContext.jsx and
// services/orderService.js's calcShipping/calcTax already expect
// (shippingZones[].tiers[], taxRules[], currency.usdToBdt), read from the
// real Settings singleton instead of a hardcoded literal that had
// drifted out of sync with it (no `tiers`, a different shape entirely).
export async function getPublicSettings() {
  const settings = await Settings.getSingleton();
  return {
    store: settings.store,
    currency: settings.currency,
    shippingZones: settings.shippingZones,
    taxRules: settings.taxRules,
    exchangePolicy: settings.exchangePolicy,
  };
}

// Full document, admin-only — includes nothing the public route omits (this
// singleton has no admin-only secrets), but kept separate from
// getPublicSettings() since that one's shape is a deliberate, narrower
// contract other code already depends on (see comment above).
export async function getSettings() {
  return Settings.getSingleton();
}

const WRITABLE_FIELDS = ["store", "currency", "promotions", "taxRules", "shippingZones", "exchangePolicy"];

export async function updateSettings(patch) {
  const settings = await Settings.getSingleton();
  for (const field of WRITABLE_FIELDS) {
    if (patch[field] !== undefined) settings[field] = patch[field];
  }
  await settings.save();
  return settings;
}
