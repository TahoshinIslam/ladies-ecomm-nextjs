import asyncHandler from "../middleware/asyncHandler.js";
import Settings from "../models/settingsModel.js";

const SETTINGS_WRITABLE_FIELDS = [
  "store",
  "currency",
  "promotions",
  "taxRules",
  "shippingZones",
];

const pickWritable = (body) => {
  const out = {};
  for (const k of SETTINGS_WRITABLE_FIELDS) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
};

// @desc    Get public settings
// @route   GET /api/settings/public
// @access  Public
export const getPublicSettings = asyncHandler(async (req, res) => {
  const s = await Settings.getSingleton();
  res.json({
    success: true,
    settings: {
      store: {
        name: s.store.name,
        logoUrl: s.store.logoUrl || "",
        logoDarkUrl: s.store.logoDarkUrl || "",
        faviconUrl: s.store.faviconUrl || "",
      },
      currency: s.currency,
      // Surface the first-order-free-shipping promo so the customer UI can
      // show a "first order? shipping is on us" hint before they hit checkout.
      promotions: {
        firstOrderFreeShipping: !!s.promotions?.firstOrderFreeShipping,
      },
      // Surface shipping zones (region + tier display currency + freeAbove
      // threshold) so the storefront can render an accurate "Free shipping
      // over X" pitch — previously hardcoded as "$200" which was wrong for
      // BD customers and ignored admin edits.
      shippingZones: (s.shippingZones || []).map((z) => ({
        region: z.region,
        currency: z.currency,
        // Pick the cheapest free-shipping threshold the customer could hit;
        // that's the most enticing pitch on a marketing surface.
        freeAbove: (z.tiers || [])
          .filter((t) => t.freeAbove > 0)
          .reduce(
            (min, t) => (min == null ? t.freeAbove : Math.min(min, t.freeAbove)),
            null,
          ),
      })),
    },
  });
});

// @desc    Get full settings
// @route   GET /api/settings
// @access  Admin
export const getSettings = asyncHandler(async (req, res) => {
  const s = await Settings.getSingleton();
  res.json({ success: true, settings: s });
});

// @desc    Update settings
// @route   PUT /api/settings
// @access  Admin
export const updateSettings = asyncHandler(async (req, res) => {
  const updates = pickWritable(req.body);
  const s = await Settings.getSingleton();
  Object.assign(s, updates);
  await s.save();
  res.json({ success: true, settings: s });
});
