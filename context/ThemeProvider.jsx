"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Provider as ReduxProvider } from "react-redux";
import { Toaster } from "sonner";

import store from "../store/index.js";
import { useGetActiveThemeQuery } from "../store/themeApi.js";
import { hydrateUi } from "../store/uiSlice.js";
import { hydrateAuth } from "../store/authSlice.js";
import { hydrateGuestCart } from "../store/guestCartSlice.js";
import { SettingsProvider } from "./SettingsContext.jsx";
import { storage } from "../lib/utils.js";

/**
 * Light/dark is an attribute on <html>, not a class: the Kinetic Editorial
 * palette is defined as `:root` / `[data-theme="dark"]` custom-property sets in
 * globals.css, and Tailwind's `dark:` variant is bound to that same attribute.
 *
 * The choice is mirrored into a cookie so the server can stamp the correct
 * attribute during SSR (see app/layout.js) and the first paint is never wrong.
 */
const THEME_COOKIE = "tahos-theme";
const THEME_STORAGE = "tahos:theme";

const applyTheme = (mode) => {
  document.documentElement.setAttribute("data-theme", mode);
  storage.set(THEME_STORAGE, mode);
  document.cookie = `${THEME_COOKIE}=${mode};path=/;max-age=31536000;samesite=lax`;
};

/**
 * Admin-authored themes override individual design tokens at runtime.
 * The values land on :root as inline custom properties, which beat the
 * stylesheet's own `:root` block, so every utility re-skins without a reload.
 */
const TOKEN_MAP = {
  primary: "--color-primary",
  primaryForeground: "--color-primary-foreground",
  accent: "--color-accent",
  accentForeground: "--color-accent-foreground",
  background: "--color-background",
  foreground: "--color-foreground",
  muted: "--color-muted",
  mutedForeground: "--color-muted-foreground",
  border: "--color-border",
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
};

const applyThemeTokens = (colors) => {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(TOKEN_MAP)) {
    const value = colors?.[key];
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
};

const ThemeContext = createContext({
  theme: null,
  mode: "light",
  isDark: false,
  toggleTheme: () => {},
  animationsEnabled: true,
});

export const useTheme = () => useContext(ThemeContext);

function ThemeController({ initialTheme = "light", children }) {
  const [mode, setMode] = useState(initialTheme);
  // A published admin theme is optional; a 404 here must not break the store.
  const { data, isLoading } = useGetActiveThemeQuery(undefined, {
    refetchOnMountOrArgChange: false,
  });
  const theme = data?.theme;

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  useEffect(() => {
    applyThemeTokens(theme ? (mode === "dark" ? theme.darkColors : theme.colors) : null);
    if (theme?.radius) {
      document.documentElement.style.setProperty("--radius", theme.radius);
    }
  }, [theme, mode]);

  const toggleTheme = useCallback(
    () => setMode((m) => (m === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo(
    () => ({
      theme,
      mode,
      isDark: mode === "dark",
      toggleTheme,
      animationsEnabled: theme?.features?.enableAnimations !== false,
      isLoading,
    }),
    [theme, mode, toggleTheme, isLoading],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Slices that persist to Web Storage start empty so the server's markup and
 * the client's first render agree. This pulls the saved values in immediately
 * after mount, in one pass, before paint.
 */
function StorageHydrator() {
  useEffect(() => {
    store.dispatch(hydrateAuth());
    store.dispatch(hydrateUi());
    store.dispatch(hydrateGuestCart());
  }, []);
  return null;
}

/**
 * Single client boundary for the whole app: Redux store, theming, settings and
 * the toast portal. Mounted once from the root layout so every route below it
 * stays a Server Component by default.
 */
export default function AppProviders({ initialTheme = "light", children }) {
  return (
    <ReduxProvider store={store}>
      <StorageHydrator />
      <ThemeController initialTheme={initialTheme}>
        <SettingsProvider>{children}</SettingsProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--elev)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              borderRadius: "12px",
              boxShadow: "var(--shadow-soft)",
            },
          }}
        />
      </ThemeController>
    </ReduxProvider>
  );
}
