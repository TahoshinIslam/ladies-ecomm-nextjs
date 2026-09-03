// Dhaka-timezone date/time formatting — the one place order timestamps (and
// any other date that should read in the store's own local time, regardless
// of where the server or the visitor's browser physically is) get formatted.
//
// Every timestamp in the database is stored in UTC (Mongoose's default `Date`
// behavior). `lib/utils.js`'s formatDate()/formatDateTime() never pin a
// `timeZone`, so they silently render in whichever timezone the *executing
// environment* happens to be in — the Next.js server process during SSR, the
// visitor's OS during hydration. Those can differ from each other (a
// server/client mismatch) and both can differ from Bangladesh. Passing an
// explicit IANA `timeZone` to Intl.DateTimeFormat fixes both problems at
// once: the conversion is applied to the UTC instant at format time (never a
// manual +6h offset, which would double-apply across DST-naive assumptions
// or already-local timestamps), and "en-US" + a fixed timeZone produces the
// exact same string on the Node server and in any browser, so there's
// nothing for React to disagree about between SSR and hydration.
const DHAKA_TZ = "Asia/Dhaka";

// bn-BD gives Bengali digits + Bengali month names ("০৪ সেপ, ২০২৬"); every
// other locale value (including the "en-BD" this app otherwise uses) falls
// back to en-US formatting — English digits, English month names, same
// output as before locale-awareness was added here.
const intlLocaleFor = (locale) => (locale === "bn-BD" ? "bn-BD" : "en-US");

const toValidDate = (input) => {
  if (input == null || input === "") return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
};

const partsOf = (date, locale, options) =>
  new Intl.DateTimeFormat(intlLocaleFor(locale), { timeZone: DHAKA_TZ, ...options }).formatToParts(date);

const pick = (parts, type) => parts.find((p) => p.type === type)?.value ?? "";

/**
 * "03 Sep 2026" (or "০৩ সেপ ২০২৬" for locale="bn-BD") — Dhaka calendar
 * date, no time.
 */
export const formatDhakaDate = (input, locale = "en-BD", fallback = "—") => {
  const date = toValidDate(input);
  if (!date) return fallback;
  const parts = partsOf(date, locale, { day: "2-digit", month: "short", year: "numeric" });
  return `${pick(parts, "day")} ${pick(parts, "month")} ${pick(parts, "year")}`;
};

/**
 * "03 Sep 2026, 10:24 PM" (or the bn-BD equivalent with Bengali digits) —
 * Dhaka calendar date + 12-hour clock with AM/PM. This is the format every
 * order timestamp in the app should use.
 */
export const formatDhakaDateTime = (input, locale = "en-BD", fallback = "—") => {
  const date = toValidDate(input);
  if (!date) return fallback;
  const parts = partsOf(date, locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const day = pick(parts, "day");
  const month = pick(parts, "month");
  const year = pick(parts, "year");
  const hour = pick(parts, "hour").padStart(2, "0");
  const minute = pick(parts, "minute");
  const dayPeriod = pick(parts, "dayPeriod").toUpperCase();
  return `${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod}`;
};
