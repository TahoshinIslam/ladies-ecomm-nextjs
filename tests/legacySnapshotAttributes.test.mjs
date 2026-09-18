// Regression coverage for a real data-fidelity bug found during post-
// migration validation (point 5 of the migration gap-closure pass):
// scripts/migrateMongoToMysql.mjs originally read `snapshot.attributes`
// directly when migrating order/cart line items, which is empty/absent on
// every Mongo document written before the cosmetics-generalization change
// (those carry `snapshot.color`/`size`/`fabric` as separate legacy fields
// instead) — silently losing the color/size/fabric a customer actually
// ordered for 5 of the app's 6 real historical orders. Fixed by extracting
// the fold-legacy-fields-in logic into lib/legacySnapshotAttributes.js,
// shared by both scripts/migrateMongoToMysql.mjs (so a future re-migration
// never regresses this again) and the one-time
// scripts/backfillOrderSnapshotAttributes.mjs (which repaired the 5
// already-migrated rows using this exact function).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveSnapshotAttributes } from "../lib/legacySnapshotAttributes.js";

describe("resolveSnapshotAttributes", () => {
  test("returns the current-shape attributes bag unchanged when present", () => {
    const snapshot = { name: "Burqa", attributes: { color: "black", size: "M" } };
    assert.deepEqual(resolveSnapshotAttributes(snapshot), { color: "black", size: "M" });
  });

  test("folds legacy color/size/fabric fields into an attributes bag when attributes is absent", () => {
    const snapshot = { name: "Burqa", color: "black", size: "free-size", fabric: "nida" };
    assert.deepEqual(resolveSnapshotAttributes(snapshot), { color: "black", size: "free-size", fabric: "nida" });
  });

  test("folds legacy fields even when attributes is present but empty — an empty {} must not win over real legacy data", () => {
    const snapshot = { name: "Burqa", attributes: {}, color: "navy", size: "L" };
    assert.deepEqual(resolveSnapshotAttributes(snapshot), { color: "navy", size: "L" });
  });

  test("only includes legacy fields that are actually present (never a spurious key with an empty/undefined value)", () => {
    const snapshot = { name: "Hijab", color: "olive" };
    assert.deepEqual(resolveSnapshotAttributes(snapshot), { color: "olive" });
  });

  test("returns an empty object when there is genuinely nothing to fold (no attributes, no legacy fields)", () => {
    assert.deepEqual(resolveSnapshotAttributes({ name: "Plain Item" }), {});
  });

  test("returns an empty object for a null/undefined snapshot rather than throwing", () => {
    assert.deepEqual(resolveSnapshotAttributes(null), {});
    assert.deepEqual(resolveSnapshotAttributes(undefined), {});
  });

  test("real fixture: the exact shape of this app's own pre-cosmetics-generalization order snapshots", () => {
    // Traced directly from the real Mongo source data this bug affected —
    // see scripts/backfillOrderSnapshotAttributes.mjs's own dry-run output
    // for the live confirmation this exact shape was actually hit.
    const snapshot = {
      name: "Saudi-Style Closed Burqa",
      sku: "BUR-SAU-BLK-FS-NIDA",
      color: "black",
      size: "free-size",
      fabric: "nida",
      price: 7800,
      image: "https://placehold.co/800x1000?text=Burqa%2BBlack",
    };
    assert.deepEqual(resolveSnapshotAttributes(snapshot), { color: "black", size: "free-size", fabric: "nida" });
  });
});
