"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isValidLocale } from "../lib/i18n/config.js";
import { translate } from "../lib/i18n/translate.js";

const LocaleContext = createContext(null);

/**
 * `initialLocale` comes from the server (app/layout.js already read the
 * cookie to stamp <html lang>), so the very first client render agrees with
 * what the server sent — no hydration mismatch, no flash of the other
 * language while this mounts.
 */
export function LocaleProvider({ initialLocale = DEFAULT_LOCALE, children }) {
  const [locale, setLocaleState] = useState(
    isValidLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE,
  );

  // <html lang> is stamped server-side on first paint, but a same-session
  // switch only updates React state and the cookie — without this, the
  // attribute would silently go stale (wrong for screen readers/browser
  // translate prompts) until the next full navigation. Mirrors
  // ThemeProvider's applyTheme(), which does the same imperative DOM update
  // for the same reason when the theme toggle fires.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Cookie, not localStorage, is the primary persistence mechanism (so the
  // server can render the right language on the next visit/refresh) — same
  // convention ThemeProvider already uses for the theme cookie.
  const setLocale = useCallback((next) => {
    if (!isValidLocale(next)) return;
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
  }, []);

  const t = useCallback((key, params) => translate(locale, key, params), [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, isBangla: locale === "bn-BD", locales: LOCALES }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Falls back to a Bangla, non-persisting stub outside the provider (mirrors
 * useSettings()'s no-context fallback) rather than throwing — a component
 * rendered in isolation (e.g. a test) still gets sane text instead of a crash.
 */
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, params) => translate(DEFAULT_LOCALE, key, params),
      isBangla: true,
      locales: LOCALES,
    };
  }
  return ctx;
}
