// Phase 5 — central server-side validation helpers. Every route that needs
// to validate a JSON body / query string / path param against a Zod schema
// (schemas/*.js) goes through one of these, so the malformed-input
// contract (400 for a bad shape, 415 for the wrong content type, safe
// field-level errors, never a raw Zod/Mongoose internal) is enforced in
// exactly one place instead of once per route.
//
// Documented contract:
//   - Malformed/unparsable JSON body -> 400.
//   - A JSON body required but the request isn't `application/json` -> 415.
//   - A body/query/path that parses but fails schema validation -> 400,
//     with an optional `errors: [{path, message}]` array (never raw
//     values, never a Zod issue object, never a stack).
//   - 422 is reserved for a request that is well-formed and passes shape
//     validation but conflicts with server-held state (e.g. Phase 4's
//     Idempotency-Key-reused-with-a-different-request case) — schema
//     validation itself never produces 422.
import { z } from "zod";

import { HttpError } from "./http.js";

// A Mongo ObjectId is exactly 24 hex characters. This intentionally does
// NOT import mongoose (schemas/lib files here stay Mongoose-free so they
// can be imported from a Client Component without pulling in server-only
// or Node-only code) — this regex is the practical, dependency-free
// equivalent of `mongoose.isValidObjectId` for the hex-string form every
// route actually receives from a URL path segment.
export const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export function isObjectIdFormat(value) {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

// Used by service functions that receive a path-derived id as a plain
// string (this codebase passes path params straight through to services
// rather than re-validating them per-route) — throws the SAME safe 400 a
// route-level zod schema would produce, before the id ever reaches a
// Mongoose query. A service that finds nothing for a well-formed id still
// throws its own 404 afterward, unaffected by this.
export function requireObjectIdFormat(value, label = "id") {
  if (!isObjectIdFormat(value)) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return value;
}

// Safe, field-level error list — path + message only. Never the submitted
// value (which could be a password, a token, or just PII) and never a raw
// Zod issue object (which can carry the input value inline).
function formatIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

function parseWithSchema(raw, schema, status = 400, label = "Invalid request") {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(status, label, formatIssues(result.error));
  }
  return result.data;
}

// Validates an ALREADY-PARSED plain object against `schema` — for the
// handful of routes (login/register/forgot-password) where a rate-limit
// check must run against the raw submitted value (e.g. the email string)
// BEFORE schema validation can reject it, so a request with an
// intentionally-malformed body still consumes a rate-limit attempt instead
// of getting a free pass by failing validation first.
export function validateData(data, schema) {
  return parseWithSchema(data, schema);
}

// Parses and validates a JSON request body against `schema`. Consumes the
// body itself (routes must not also call request.json()).
export async function parseJsonBody(request, schema) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  let raw;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "Malformed JSON body");
  }
  // A non-object JSON body (e.g. the literal `null`, `"a string"`, `42`,
  // or a bare array) can never satisfy an object schema meaningfully and
  // some of it (null) would otherwise slip past a `.safeParse` that isn't
  // expecting it — reject up front with the same 400 shape.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  // Applied to every JSON body before schema validation, globally, across
  // every route that uses this helper — a defense-in-depth net independent
  // of any one schema's own field list (see the function's own doc
  // comment above).
  assertNoOperatorInjection(raw);
  return parseWithSchema(raw, schema);
}

// Reconstructs URLSearchParams into a plain object WITHOUT silently
// collapsing a repeated key to its last value — a key that appears more
// than once becomes an array, which every schema built with this helper's
// scalar param schemas (see schemas/commonSchemas.js) will then reject
// outright (an ambiguous repeated query param is refused, not guessed at).
export function queryParamsToObject(searchParams) {
  const obj = {};
  for (const key of searchParams.keys()) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) continue; // already collected via getAll below
    const values = searchParams.getAll(key);
    obj[key] = values.length > 1 ? values : values[0];
  }
  return obj;
}

export function parseQuery(searchParams, schema) {
  return parseWithSchema(queryParamsToObject(searchParams), schema);
}

// GET /api/products (see lib/http.js's parseQueryParams()) deliberately
// does NOT go through queryParamsToObject/parseQuery above — its
// bracket-notation range params (`basePrice[lte]=25`) need parseQueryParams'
// own nested-object reconstruction instead. That means it never got this
// scalarParam-based "a repeated key already fails validation" guarantee for
// free, so Phase 5D adds it explicitly: a literal repeated raw query key
// (`?page=1&page=2`) is ambiguous and rejected outright, matching the same
// "never silently pick one" contract every other list route already has.
export function assertNoDuplicateQueryKeys(searchParams) {
  const seen = new Set();
  for (const key of searchParams.keys()) {
    if (seen.has(key)) throw new HttpError(400, `Duplicate query parameter: ${key}`);
    seen.add(key);
  }
}

// A `?__proto__=x` (or constructor/prototype) query key can never actually
// pollute anything by the time it reaches parseQueryParams()'s plain
// `{}`-literal accumulator — `obj.__proto__ = "a string"` is a silent
// no-op assignment to the accessor, not a real own property, the same JS
// quirk assertNoOperatorInjection's own comment documents for JSON bodies
// (there the JSON.parse() step makes it a genuine own key; here it never
// becomes one at all). That makes the key invisible to any later
// Object.keys()-based check rather than unsafe — but "invisible" still
// isn't the same as "explicitly rejected," so this checks the RAW
// URLSearchParams keys directly (which preserve the literal string
// unaffected by that object-literal quirk) before any object is ever
// built from them.
const DANGEROUS_RAW_QUERY_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function assertNoDangerousQueryKeys(searchParams) {
  for (const key of searchParams.keys()) {
    if (DANGEROUS_RAW_QUERY_KEYS.has(key)) throw new HttpError(400, "Invalid query parameter");
  }
}

export function parsePathParams(params, schema) {
  return parseWithSchema(params, schema, 400, "Invalid path parameters");
}

// Recursively rejects MongoDB-operator-shaped and prototype-pollution-
// shaped keys anywhere in a plain object/array that's about to be used to
// build a Mongo query or get passed to a Mongoose write — a defense-in-
// depth net independent of (and in addition to) each schema's own field
// list, since a schema only constrains the fields it knows about; this
// catches an operator smuggled in under a field name the schema didn't
// anticipate, or into a nested object a schema left loosely typed.
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function assertNoOperatorInjection(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoOperatorInjection(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key.startsWith("$") || DANGEROUS_KEYS.has(key) || key.includes(".")) {
        throw new HttpError(400, "Invalid field name in request body");
      }
      assertNoOperatorInjection(value[key], path ? `${path}.${key}` : key);
    }
  }
}

// Phase 5B — validates the Cloudinary upload `folder` query param. Only
// letters/digits/underscore/hyphen/forward-slash (for one level of real
// subfolder nesting), no `..`, no leading/trailing/doubled slash, no
// whitespace or control characters, bounded length — closes off path-
// traversal-shaped values and anything that looks like it's trying to
// inject Cloudinary transformation syntax (which uses `,`/`:`/whitespace,
// none of which this allowlist permits).
const FOLDER_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

// A verification/reset token as generated by crypto.randomBytes(32)
// .toString("hex") — always exactly 64 lowercase hex characters. Bounds
// format WITHOUT changing the caller's error status/message from the
// existing not-found case — both a malformed token and a well-formed-but-
// unknown one must be indistinguishable to the client (same generic 400),
// so this never introduces a new enumeration/timing signal, just a
// cheaper rejection before ever hashing/querying.
const HEX_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isHexTokenFormat(token) {
  return typeof token === "string" && HEX_TOKEN_RE.test(token);
}

export function requireSafeFolder(folder, fallback = "shoestore") {
  if (folder === null || folder === undefined || folder === "") return fallback;
  if (typeof folder !== "string" || folder.length > 100 || !FOLDER_RE.test(folder)) {
    throw new HttpError(400, "Invalid folder");
  }
  return folder;
}

export { z };
