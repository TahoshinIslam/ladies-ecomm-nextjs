// Single source of truth for supported locales — imported by both the
// server (cookie read in app/layout.js, generateMetadata) and the client
// (LocaleProvider). Bangla is the default per product requirement: a new
// visitor with no saved preference always sees Bangla, never an
// auto-detected browser language.
export const LOCALES = ["bn-BD", "en-BD"];
export const DEFAULT_LOCALE = "bn-BD";
export const LOCALE_COOKIE = "tahos_locale";

export const isValidLocale = (value) => LOCALES.includes(value);
