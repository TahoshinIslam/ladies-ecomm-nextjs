// Server Component -> Client Component data must be plain,
// JSON-serializable objects: a model object can carry Date instances and
// attached methods (e.g. a user's save()/matchPassword()), which React's
// Server/Client boundary (the "flight" protocol) cannot serialize.
// JSON.parse(JSON.stringify(...)) is a safe, well-understood deep-serializer
// for this case: functions are dropped and Date defines its own toJSON()
// (an ISO 8601 string), with no per-model boilerplate.
//
// This does NOT strip sensitive fields, and nothing below it does either:
// models return whole rows (a customer row carries the password hash, reset
// token and lockout state). Callers must pass only the fields a page
// actually needs — never a whole model object such as the session user.
export function serializeForClient(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
