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
    homepage: settings.homepage,
    currency: settings.currency,
    shippingZones: settings.shippingZones,
    taxRules: settings.taxRules,
    exchangePolicy: settings.exchangePolicy,
  };
}


const WRITABLE_FIELDS = ["store", "homepage", "currency", "promotions", "taxRules", "shippingZones", "exchangePolicy"];


