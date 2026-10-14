import Theme from "../models/themeModel.js";

// Public — the storefront's ThemeProvider fetches this on every page load.
export async function getActiveTheme() {
  let theme = await Theme.findActive();
  if (!theme) theme = await Theme.create({ name: "Default", isActive: true });
  return theme;
}
