// Regression coverage for a confirmed production-audit finding: this
// app's MySQL/MariaDB server runs with time_zone=SYSTEM (this host's local
// zone — Asia/Dhaka, UTC+6, confirmed directly). Every DEFAULT
// CURRENT_TIMESTAMP(3)/ON UPDATE CURRENT_TIMESTAMP(3) column default and
// every explicit NOW(3) call in models/*.js is evaluated by the SERVER in
// its own SESSION time_zone — a property of the physical connection, not
// of config/db.js's `timezone: "Z"` client option (which only controls
// how mysql2 marshals/unmarshals DATETIME values between a JS Date and a
// wire string, and does nothing to change what the server itself computes
// for a server-side function). Before the fix, nothing ever set the
// session's own time_zone, so those server-computed values were silently
// ~6 hours off from true UTC while every comparison elsewhere in the
// codebase assumed UTC.
//
// This test distinguishes the four layers explicitly, per the audit's own
// framing, rather than asserting one aggregate number:
//   1. Storage: DATETIME(3) columns carry no timezone of their own — a
//      stored value is only meaningful given a shared writer/reader
//      convention (this is not itself buggy, just a precondition).
//   2. Connection/session timezone: what config/db.js's pool.on("connection")
//      hook (SET time_zone = '+00:00') is responsible for.
//   3. Serialization: mysql2's `timezone: "Z"` client option, which
//      interprets/formats DATETIME values assuming they ARE UTC — correct
//      only once (2) is also true.
//   4. Display: everything downstream (lib/date.js, UI) trusts whatever a
//      JS Date object built from (2)+(3) says — out of scope for this
//      file, verified indirectly by (2)+(3) being correct.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Database connection timezone correctness (confirmed 6-hour-drift fix)", { skip: !canRun && reason }, () => {
  after(async () => {
    await disconnectTestDb();
  });

  test("layer 2 — every pooled connection's own SESSION time_zone is UTC, not the server's SYSTEM zone", async () => {
    await connectTestDb();
    const { withConnection } = await import("../config/db.js");
    await withConnection(async (conn) => {
      const [rows] = await conn.query("SELECT @@session.time_zone AS tz, @@global.time_zone AS global_tz");
      assert.equal(rows[0].tz, "+00:00", "config/db.js's pool.on('connection', ...) must set every physical connection's session time_zone to UTC");
      // The server's own GLOBAL setting is deliberately left untouched —
      // this fix must never require (or attempt) changing the database
      // server's own configuration, only this app's own sessions.
      assert.notEqual(rows[0].global_tz, "+00:00", "sanity check: this environment's server global time_zone is still SYSTEM/local, confirming the fix is session-scoped, not a coincidence of an already-UTC server");
    });
  });

  test("layers 2+3 together — a real DEFAULT CURRENT_TIMESTAMP(3) write matches true UTC within milliseconds, not ~6 hours", async () => {
    const { withConnection } = await import("../config/db.js");
    await withConnection(async (conn) => {
      await conn.query("CREATE TEMPORARY TABLE tz_regression_probe (id INT PRIMARY KEY AUTO_INCREMENT, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))");
      const before = Date.now();
      await conn.query("INSERT INTO tz_regression_probe () VALUES ()");
      const after = Date.now();
      const [rows] = await conn.query("SELECT created_at FROM tz_regression_probe ORDER BY id DESC LIMIT 1");
      const storedMs = rows[0].created_at.getTime();

      // Confirmed pre-fix behavior (documented, not re-introduced): this
      // would previously read ~6 hours (21,600,000ms) ahead of `after`.
      // Bounded generously (5s) for real scheduling/network jitter, while
      // still failing hard on anything resembling the old bug (which was
      // off by hours, not milliseconds).
      assert.ok(
        storedMs >= before - 5000 && storedMs <= after + 5000,
        `DEFAULT CURRENT_TIMESTAMP(3) drifted ${storedMs - after}ms from real UTC 'now' — expected within ±5000ms, not ~6 hours`,
      );
    });
  });

  test("layer 3 — mysql2's client-side `timezone: \"Z\"` option assumption is now actually true: UTC_TIMESTAMP(3) and NOW(3) agree, since the session itself is UTC", async () => {
    const { withConnection } = await import("../config/db.js");
    await withConnection(async (conn) => {
      const [rows] = await conn.query("SELECT NOW(3) AS now_val, UTC_TIMESTAMP(3) AS utc_val");
      const diffMs = Math.abs(rows[0].now_val.getTime() - rows[0].utc_val.getTime());
      assert.ok(diffMs < 1000, `NOW(3) and UTC_TIMESTAMP(3) must agree within ~1s once the session is UTC — observed ${diffMs}ms apart`);
    });
  });
});
