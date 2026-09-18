// Shared by scripts/migrateMongoToMysql.mjs and
// scripts/backfillOrderSnapshotAttributes.mjs — see either file's own
// comment for the full story: a cart/order line's `snapshot.attributes` is
// the current (post-cosmetics-generalization) shape, an arbitrary
// key/value bag; a Mongo document written before that change instead
// carries `snapshot.color`/`size`/`fabric` as separate top-level fields,
// with no `attributes` field at all. Reading `snapshot.attributes` alone
// silently produces an empty object for every one of those older
// snapshots — real historical order/cart data, not a placeholder.
//
// Pure function, no I/O, so both call sites and this module's own test
// (tests/legacySnapshotAttributes.test.mjs) can exercise it without a
// database or a Mongo connection.

export function resolveSnapshotAttributes(snapshot) {
  if (!snapshot) return {};
  if (snapshot.attributes && Object.keys(snapshot.attributes).length > 0) return snapshot.attributes;
  const legacy = {};
  if (snapshot.color) legacy.color = snapshot.color;
  if (snapshot.size) legacy.size = snapshot.size;
  if (snapshot.fabric) legacy.fabric = snapshot.fabric;
  return legacy;
}
