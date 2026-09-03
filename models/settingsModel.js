import mongoose from "mongoose";

const taxRuleSchema = new mongoose.Schema(
  {
    region: { type: String, required: true },
    label: { type: String, default: "Tax" },
    rate: { type: Number, required: true, min: 0, max: 1 },
    inclusive: { type: Boolean, default: false },
  },
  { _id: false },
);

const shippingTierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    baseCost: { type: Number, required: true, min: 0 },
    freeAbove: { type: Number, default: 0 },
  },
  { _id: false },
);

const shippingZoneSchema = new mongoose.Schema(
  {
    region: { type: String, required: true },
    currency: { type: String, required: true, enum: ["BDT", "USD"] },
    tiers: { type: [shippingTierSchema], default: [] },
  },
  { _id: false },
);

const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "main" },

    store: {
      name: { type: String, default: "My Store" },
      supportEmail: { type: String, default: "" },
      supportPhone: { type: String, default: "" },
      // Branding — the live site reads from these. Admin can either paste
      // an existing URL or upload a file via the Settings page (which uses
      // the existing /api/upload endpoint and stores the returned URL here).
      logoUrl: { type: String, default: "" },
      logoDarkUrl: { type: String, default: "" },
      faviconUrl: { type: String, default: "" },
    },

    currency: {
      defaultDisplay: { type: String, default: "BDT", enum: ["BDT", "USD"] },
      usdToBdt: { type: Number, default: 120, min: 1 },
    },

    // Promotion: free shipping on a customer's first order. Admin can toggle.
    promotions: {
      firstOrderFreeShipping: { type: Boolean, default: false },
    },

    taxRules: {
      type: [taxRuleSchema],
      default: () => [
        { region: "BD", label: "VAT", rate: 0.15, inclusive: true },
        { region: "INTL", label: "No tax", rate: 0, inclusive: false },
      ],
    },

    shippingZones: {
      type: [shippingZoneSchema],
      default: () => [
        {
          region: "BD",
          currency: "BDT",
          tiers: [
            { name: "Inside Dhaka", baseCost: 60, freeAbove: 2000 },
            { name: "Outside Dhaka", baseCost: 120, freeAbove: 2000 },
          ],
        },
        {
          region: "INTL",
          currency: "USD",
          tiers: [{ name: "Standard", baseCost: 25, freeAbove: 200 }],
        },
      ],
    },
  },
  { timestamps: true },
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findById("main");
  if (!doc) doc = await this.create({ _id: "main" });
  return doc;
};

const Settings = mongoose.model("settings", settingsSchema);
export default Settings;
