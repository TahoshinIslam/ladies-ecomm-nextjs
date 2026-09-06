// Phase 7 — Server Component -> Client Component data must be plain,
// JSON-serializable objects: a Mongoose document (or a lean() result still
// holding BSON ObjectId/Date instances) is a class instance, not plain
// data, and React's Server/Client boundary (the "flight" protocol) cannot
// serialize it. JSON.parse(JSON.stringify(...)) is a safe, well-understood
// deep-serializer for this specific case because both BSON's ObjectId and
// native Date already define their own `toJSON()` (ObjectId -> its hex
// string, Date -> an ISO 8601 string) — the exact "ObjectIds to strings,
// Dates to stable ISO strings" contract this phase requires, with no
// per-model boilerplate.
//
// This does NOT strip sensitive fields — `select: false` schema fields
// (password, resetPasswordToken, etc.) are already excluded by Mongoose
// from any query that doesn't explicitly `.select("+field")` them back in,
// the same guarantee every Route Handler already relies on. Callers are
// still responsible for only querying/projecting the fields a page
// actually needs (see each server page's own service call).
export function serializeForClient(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
