import bn from "./dictionaries/bn.js";
import en from "./dictionaries/en.js";
import { DEFAULT_LOCALE } from "./config.js";

const DICTS = { "bn-BD": bn, "en-BD": en };
const FALLBACK_LOCALE = "en-BD";

const getPath = (obj, path) =>
  path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);

// Minimal ICU-style plural: "{count, one {# item} other {# items}}" — `#`
// is replaced with the formatted count. English "one" is count === 1;
// Bangla has no grammatical plural, so its dictionaries just repeat the
// same phrase in both branches (kept as a real ICU block rather than a
// plain string so the shape matches en.js key-for-key, which is what the
// missing-key dev warning depends on to catch real drift between the two).
// Not string-anchored: a dictionary value may wrap the block in its own
// literal text (e.g. "({count, one {...} other {...}})" for a
// parenthesized review count) — only the ICU block itself is replaced,
// whatever surrounds it passes through untouched.
const PLURAL_RE = /\{count,\s*(?:one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}|other\s*\{([^}]*)\}\s*one\s*\{([^}]*)\})\}/;

const resolvePlural = (template, count, formattedCount) => {
  const m = template.match(PLURAL_RE);
  if (!m) return template;
  const one = m[1] ?? m[4];
  const other = m[2] ?? m[3];
  const branch = (Number(count) === 1 ? one : other).replace(/#/g, formattedCount ?? String(count));
  return template.slice(0, m.index) + branch + template.slice(m.index + m[0].length);
};

const interpolate = (str, params) => {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
};

const warnedKeys = new Set();
const warnMissing = (key, locale) => {
  if (process.env.NODE_ENV === "production") return;
  const dedupeKey = `${locale}:${key}`;
  if (warnedKeys.has(dedupeKey)) return;
  warnedKeys.add(dedupeKey);
  console.warn(`[i18n] Missing translation key "${key}" for locale "${locale}"`);
};

/**
 * Resolve one translation key for a given locale.
 *
 * - `params.count` triggers ICU-lite plural resolution when the dictionary
 *   value is a "{count, one {...} other {...}}" template.
 * - Any other `{name}` placeholder in the resolved string is interpolated
 *   from `params`.
 * - A key missing from the target locale's dictionary falls back to
 *   English (never a blank string), and logs a dev-only warning once per
 *   key so gaps get noticed during development, not silently shipped.
 * - A key missing from every dictionary returns the key itself — visibly
 *   wrong instead of invisibly blank, so it's easy to spot in the UI.
 */
export function translate(locale, key, params) {
  const dict = DICTS[locale] || DICTS[DEFAULT_LOCALE];
  let value = getPath(dict, key);

  if (value === undefined) {
    warnMissing(key, locale);
    value = getPath(DICTS[FALLBACK_LOCALE], key);
  }

  if (value === undefined) return key;
  if (typeof value !== "string") return key;

  if (params && "count" in params) {
    value = resolvePlural(value, params.count, params.count);
  }

  return interpolate(value, params);
}

export { DICTS };
