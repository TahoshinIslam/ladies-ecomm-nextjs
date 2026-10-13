import Theme from "../models/themeModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

const PRESETS = [
  { name: "Classic Black", colors: { primary: "#0a0a0a", accent: "#ef4444" } },
  { name: "Sunset Orange", colors: { primary: "#ea580c", accent: "#facc15", background: "#fef7ed" } },
  { name: "Ocean Blue", colors: { primary: "#0369a1", accent: "#06b6d4", background: "#f0f9ff" } },
  { name: "Forest Green", colors: { primary: "#166534", accent: "#84cc16", background: "#f7fee7" } },
  { name: "Royal Purple", colors: { primary: "#6d28d9", accent: "#ec4899", background: "#faf5ff" } },
];

// Public — the storefront's ThemeProvider fetches this on every page load.
export async function getActiveTheme() {
  let theme = await Theme.findActive();
  if (!theme) theme = await Theme.create({ name: "Default", isActive: true });
  return theme;
}

// ========== ADMIN ==========








