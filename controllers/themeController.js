import asyncHandler from "../middleware/asyncHandler.js";
import Theme from "../models/themeModel.js";

// @desc    Get the active theme (public — frontend uses this on every page load)
// @route   GET /api/theme/active
// @access  Public
export const getActiveTheme = asyncHandler(async (req, res) => {
  let theme = await Theme.findOne({ isActive: true });
  if (!theme) {
    // Bootstrap: create default theme on first request
    theme = await Theme.create({ name: "Default", isActive: true });
  }
  res.json({ success: true, theme });
});

// ========== ADMIN ==========

// @desc    List all themes
// @route   GET /api/theme
// @access  Admin
export const getAllThemes = asyncHandler(async (req, res) => {
  const themes = await Theme.find().sort("-isActive -createdAt");
  res.json({ success: true, count: themes.length, themes });
});

// @desc    Get one theme
// @route   GET /api/theme/:id
// @access  Admin
export const getTheme = asyncHandler(async (req, res) => {
  const theme = await Theme.findById(req.params.id);
  if (!theme) {
    res.status(404);
    throw new Error("Theme not found");
  }
  res.json({ success: true, theme });
});

// @desc    Create new theme
// @route   POST /api/theme
// @access  Admin
export const createTheme = asyncHandler(async (req, res) => {
  const theme = await Theme.create({ ...req.body, updatedBy: req.user._id });
  res.status(201).json({ success: true, theme });
});

// @desc    Update theme (partial — deep-merge for nested color objects)
// @route   PUT /api/theme/:id
// @access  Admin
export const updateTheme = asyncHandler(async (req, res) => {
  const theme = await Theme.findById(req.params.id);
  if (!theme) {
    res.status(404);
    throw new Error("Theme not found");
  }

  // Deep merge the nested subdocs so partial updates don't nuke existing fields
  const nestedKeys = ["colors", "darkColors", "fonts", "features"];
  for (const key of Object.keys(req.body)) {
    if (nestedKeys.includes(key) && typeof req.body[key] === "object") {
      theme[key] = { ...theme[key].toObject?.() || theme[key], ...req.body[key] };
    } else {
      theme[key] = req.body[key];
    }
  }
  theme.updatedBy = req.user._id;
  await theme.save();

  res.json({ success: true, theme });
});

// @desc    Activate a theme (deactivates others via pre-save hook)
// @route   POST /api/theme/:id/activate
// @access  Admin
export const activateTheme = asyncHandler(async (req, res) => {
  const theme = await Theme.findById(req.params.id);
  if (!theme) {
    res.status(404);
    throw new Error("Theme not found");
  }
  theme.isActive = true;
  theme.updatedBy = req.user._id;
  await theme.save();
  res.json({ success: true, theme });
});

// @desc    Delete theme
// @route   DELETE /api/theme/:id
// @access  Admin
export const deleteTheme = asyncHandler(async (req, res) => {
  const theme = await Theme.findById(req.params.id);
  if (!theme) {
    res.status(404);
    throw new Error("Theme not found");
  }
  if (theme.isActive) {
    res.status(400);
    throw new Error("Cannot delete the active theme. Activate another first.");
  }
  await theme.deleteOne();
  res.json({ success: true, message: "Theme deleted" });
});

// @desc    Preset themes — seed a few good-looking ones
// @route   POST /api/theme/seed-presets
// @access  Admin
export const seedPresets = asyncHandler(async (req, res) => {
  const presets = [
    {
      name: "Classic Black",
      colors: { primary: "#0a0a0a", accent: "#ef4444" },
    },
    {
      name: "Sunset Orange",
      colors: { primary: "#ea580c", accent: "#facc15", background: "#fef7ed" },
    },
    {
      name: "Ocean Blue",
      colors: { primary: "#0369a1", accent: "#06b6d4", background: "#f0f9ff" },
    },
    {
      name: "Forest Green",
      colors: { primary: "#166534", accent: "#84cc16", background: "#f7fee7" },
    },
    {
      name: "Royal Purple",
      colors: { primary: "#6d28d9", accent: "#ec4899", background: "#faf5ff" },
    },
  ];

  const results = [];
  for (const p of presets) {
    const exists = await Theme.findOne({ name: p.name });
    if (!exists) results.push(await Theme.create({ ...p, updatedBy: req.user._id }));
  }
  res.status(201).json({ success: true, created: results.length, themes: results });
});
