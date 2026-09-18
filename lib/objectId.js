import crypto from "crypto";

// Generates ids in the exact same shape as a MongoDB ObjectId (12 bytes,
// rendered as 24 lowercase hex chars: a 4-byte unix-seconds timestamp + a
// 5-byte random value + a 3-byte counter) — see sql/schema.sql's header
// comment for why every table keeps this format instead of switching to an
// AUTO_INCREMENT integer: existing "order number" (`_id.slice(-6)`) and
// slug-suffix logic throughout the app depends on ids looking like this.
// Not cryptographically tied to Mongo's own driver implementation, but
// produces output indistinguishable from (and interoperable with) it.
let counter = crypto.randomBytes(3).readUIntBE(0, 3);

export function generateObjectId() {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  crypto.randomBytes(5).copy(buf, 4);
  counter = (counter + 1) & 0xffffff;
  buf.writeUIntBE(counter, 9, 3);
  return buf.toString("hex");
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export function isObjectIdFormat(value) {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}
