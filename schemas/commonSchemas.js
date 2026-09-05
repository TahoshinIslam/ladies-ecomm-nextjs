// Phase 5 — shared Zod schemas. Client-safe: no Mongoose, no database
// calls, no Node-only APIs, no secrets, no circular imports. Safe to
// import from a Client Component for client-side form validation (see
// views/CheckoutPage.jsx and friends) — the server (lib/validation.js +
// each route) is what actually enforces these; client-side use is UX only.
import { z } from "zod";

// A Mongo ObjectId as it arrives from a URL path segment: exactly 24 hex
// characters. Deliberately a plain regex, not `mongoose.isValidObjectId`,
// so this file stays Mongoose-free.
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "must be a valid id");

// A single scalar query-param value. Rejects the array shape
// lib/validation.js's queryParamsToObject() produces for a REPEATED query
// key — an ambiguous `?limit=1&limit=2` is refused outright, not resolved
// by picking one.
const scalarParam = z.string();

// A bounded, positive-integer query param (pagination page/limit and
// similar "how many/which page" values). Accepts only an ASCII string of
// digits — no leading `+`/`-`, no decimal point, no exponent notation, no
// leading/trailing whitespace, no repeated-param array. `Number()` on an
// all-digit string long enough to overflow returns `Infinity`, which the
// final `.int()` re-check rejects (`Number.isInteger(Infinity) === false`).
export function boundedIntParam({ min = 1, max = Number.MAX_SAFE_INTEGER, defaultValue } = {}) {
  return scalarParam
    .optional()
    .transform((val) => (val === undefined || val === "" ? defaultValue : val))
    .refine((val) => val === defaultValue || /^\d+$/.test(String(val)), {
      message: "must be a positive integer with no sign, decimal point, or whitespace",
    })
    .transform((val) => (val === defaultValue ? val : Number(val)))
    .refine((val) => Number.isInteger(val) && val >= min && val <= max, {
      message: `must be an integer between ${min} and ${max}`,
    });
}

export function paginationSchema({ maxLimit = 100, defaultLimit = 20 } = {}) {
  return z.object({
    page: boundedIntParam({ min: 1, defaultValue: 1 }),
    limit: boundedIntParam({ min: 1, max: maxLimit, defaultValue: defaultLimit }),
  });
}

// Builds a schema for a "sortBy" query param restricted to an allowlist of
// real, indexed/sortable fields — the same allowlist idea already used by
// services/orderService.js's ORDER_SORT_FIELDS etc., now enforced at the
// validation layer too (defense in depth, not a replacement).
export function sortFieldSchema(allowedFields, defaultField) {
  return z.enum(allowedFields).optional().default(defaultField);
}

export const sortOrderSchema = z.enum(["asc", "desc"]).optional().default("desc");

// A short, trimmed, non-empty search string — bounded so a client can't
// hand a megabyte-long value into a regex построение (services/*.js
// escapes it before use, but the length bound is validation's job, not
// the escaper's).
export const searchQuerySchema = z.string().trim().max(200).optional();

// Trimmed, required, non-whitespace-only string with bounds. Covers the
// common "a required label/name/title field" shape.
export function requiredString({ min = 1, max = 200 } = {}) {
  return z
    .string()
    .trim()
    .min(min, `must be at least ${min} character${min === 1 ? "" : "s"}`)
    .max(max, `must be at most ${max} characters`);
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email("must be a valid email address");

// Loose, permissive phone format — this app is not phone-number-format-
// authoritative (no SMS/OTP integration ever reads this field), and the
// existing regression suite's address fixtures predate any phone
// validation at all (many use a single-character placeholder). This only
// bounds length and rejects a whitespace-only value, rather than
// validating a specific national format or character set.
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "phone number is required")
  .max(20, "phone number is too long");

// A finite, non-negative monetary/numeric amount — rejects NaN, Infinity,
// and negatives. Callers needing a strictly-positive amount should chain
// `.positive()`.
export const nonNegativeFiniteNumber = z.number().finite().nonnegative();

export const positiveIntSchema = z.number().int().positive();

// A bounded positive quantity — an order/cart line-item quantity has no
// legitimate reason to be in the thousands; this bound exists to stop a
// single line item from being used as a stock-exhaustion or overflow
// vector, independent of whatever real stock the product has.
export const quantitySchema = z.number().int().positive().max(999, "quantity is too large");

export const urlSchema = z
  .string()
  .trim()
  .url("must be a valid URL")
  .refine((val) => /^https?:\/\//i.test(val), "must use http or https");

// A day count used by analytics range queries — bounded so a client can't
// request a multi-decade aggregation window.
export const daysRangeSchema = boundedIntParam({ min: 1, max: 365, defaultValue: 30 });
