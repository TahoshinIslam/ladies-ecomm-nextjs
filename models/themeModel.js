import mongoose from "mongoose";

/**
 * A singleton-ish document holding the site's active theme tokens.
 * Frontend fetches this once on boot and converts it to CSS variables.
 * Admin can update it live from the dashboard; all visitors see the new
 * theme on next page load (or via a WebSocket refresh if you add it later).
 */
const themeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      default: "Default",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },

    // --- Color tokens (hex or oklch) ---
    colors: {
      primary: { type: String, default: "#111111" },
      primaryForeground: { type: String, default: "#ffffff" },
      accent: { type: String, default: "#f97316" }, // orange-500
      accentForeground: { type: String, default: "#ffffff" },
      background: { type: String, default: "#ffffff" },
      foreground: { type: String, default: "#0a0a0a" },
      muted: { type: String, default: "#f5f5f5" },
      mutedForeground: { type: String, default: "#737373" },
      border: { type: String, default: "#e5e5e5" },
      success: { type: String, default: "#10b981" },
      warning: { type: String, default: "#f59e0b" },
      danger: { type: String, default: "#ef4444" },
    },

    // Dark mode tokens (same keys)
    darkColors: {
      primary: { type: String, default: "#fafafa" },
      primaryForeground: { type: String, default: "#0a0a0a" },
      accent: { type: String, default: "#fb923c" },
      accentForeground: { type: String, default: "#0a0a0a" },
      background: { type: String, default: "#0a0a0a" },
      foreground: { type: String, default: "#fafafa" },
      muted: { type: String, default: "#262626" },
      mutedForeground: { type: String, default: "#a3a3a3" },
      border: { type: String, default: "#262626" },
      success: { type: String, default: "#34d399" },
      warning: { type: String, default: "#fbbf24" },
      danger: { type: String, default: "#f87171" },
    },

    // --- Typography ---
    fonts: {
      heading: { type: String, default: "Inter, system-ui, sans-serif" },
      body: { type: String, default: "Inter, system-ui, sans-serif" },
    },

    // --- Shape & spacing ---
    radius: { type: String, default: "0.75rem" }, // border-radius base
    shadowStyle: {
      type: String,
      enum: ["none", "soft", "medium", "hard"],
      default: "soft",
    },
    density: {
      type: String,
      enum: ["compact", "comfortable", "spacious"],
      default: "comfortable",
    },

    // --- Branding ---
    logoUrl: { type: String, default: "" },
    logoDarkUrl: { type: String, default: "" },
    faviconUrl: { type: String, default: "" },
    siteName: { type: String, default: "ShoeStore" },
    tagline: { type: String, default: "Step into something new." },

    // --- Feature toggles (admin can flip these from dashboard) ---
    features: {
      enableDarkMode: { type: Boolean, default: true },
      enableAnimations: { type: Boolean, default: true },
      enableWishlist: { type: Boolean, default: true },
      enableCompare: { type: Boolean, default: true },
      enableReviews: { type: Boolean, default: true },
      enableCoupons: { type: Boolean, default: true },
      announcementBar: { type: String, default: "" },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  },
  { timestamps: true },
);

// Ensure only one active theme at a time
themeSchema.pre("save", async function (next) {
  if (this.isActive && this.isModified("isActive")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isActive: true },
      { isActive: false },
    );
  }
  next();
});

const Theme = mongoose.model("themes", themeSchema);
export default Theme;
