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
// Returning a real, bootstrapped theme here (rather than always null) is
// what actually lets the admin-editable palette reach the live site; it was
// previously a hardcoded `{ theme: null }` stub regardless of what existed
// in the database.
export async function getActiveTheme() {
  let theme = await Theme.findOne({ isActive: true });
  if (!theme) theme = await Theme.create({ name: "Default", isActive: true });
  return theme;
}

// ========== ADMIN ==========

export async function getAllThemes() {
  return Theme.find().sort("-isActive -createdAt");
}

export async function getTheme(id) {
  requireObjectIdFormat(id, "id");
  const theme = await Theme.findById(id);
  if (!theme) throw new HttpError(404, "Theme not found");
  return theme;
}

export async function createTheme(body, adminId) {
  return Theme.create({ ...body, updatedBy: adminId });
}

export async function updateTheme(id, body, adminId) {
  requireObjectIdFormat(id, "id");
  const theme = await Theme.findById(id);
  if (!theme) throw new HttpError(404, "Theme not found");

  // Deep-merge the nested subdocs so a partial update doesn't wipe fields
  // the caller didn't send (e.g. changing one color shouldn't blank the rest).
  const nestedKeys = ["colors", "darkColors", "fonts", "features"];
  for (const key of Object.keys(body)) {
    if (nestedKeys.includes(key) && typeof body[key] === "object" && body[key] !== null) {
      theme[key] = { ...(theme[key]?.toObject?.() || theme[key]), ...body[key] };
    } else {
      theme[key] = body[key];
    }
  }
  theme.updatedBy = adminId;
  await theme.save();
  return theme;
}

export async function activateTheme(id, adminId) {
  requireObjectIdFormat(id, "id");
  const theme = await Theme.findById(id);
  if (!theme) throw new HttpError(404, "Theme not found");
  theme.isActive = true;
  theme.updatedBy = adminId;
  await theme.save(); // pre-save hook deactivates every other theme
  return theme;
}

export async function deleteTheme(id) {
  requireObjectIdFormat(id, "id");
  const theme = await Theme.findById(id);
  if (!theme) throw new HttpError(404, "Theme not found");
  if (theme.isActive) throw new HttpError(400, "Cannot delete the active theme. Activate another first.");
  await theme.deleteOne();
}

export async function seedPresets(adminId) {
  const created = [];
  for (const preset of PRESETS) {
    const exists = await Theme.findOne({ name: preset.name });
    if (!exists) created.push(await Theme.create({ ...preset, updatedBy: adminId }));
  }
  return created;
}
