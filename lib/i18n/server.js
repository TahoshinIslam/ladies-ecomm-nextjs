import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale } from "./config.js";
import { translate } from "./translate.js";

/**
 * Server Component / route handler / generateMetadata locale resolution.
 * Bangla whenever the cookie is absent or holds something invalid — never
 * derived from Accept-Language, per the "no browser-language auto-select"
 * requirement.
 */
export async function getServerLocale() {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isValidLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * `const t = await getT()` inside a Server Component or generateMetadata —
 * same key/param contract as the client `useLocale().t`.
 */
export async function getT() {
  const locale = await getServerLocale();
  return (key, params) => translate(locale, key, params);
}
