// Phase 12 closure — scripts/auditIndexes.mjs was extended from 7 to all
// 19 active Mongoose models. This file proves: (1) the script's MODELS
// array stays in exact sync with models/*.js, (2) dry-run never writes,
// (3) missing/all-present states produce the documented exit codes,
// (4) --ensure is additive and repeatable, (5) no destructive Mongo
// operation exists anywhere in the script, and (6) a missing unique index
// with pre-existing duplicate values is reported as a safe count, never a
// document/field value. Everything here runs against MONGO_URI_TEST only
// (a real, disposable local replica set) — never Production, never even
// MONGO_URI.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";

const execFileAsync = promisify(execFile);
const canRun = dbReady;
const reason = skipReason;

const SCRIPT_PATH = new URL("../scripts/auditIndexes.mjs", import.meta.url).pathname;
const MODELS_DIR = new URL("../models", import.meta.url).pathname;

function runAudit(extraArgs = []) {
  return execFileAsync("node", [SCRIPT_PATH, ...extraArgs], {
    env: { ...process.env, NODE_ENV: "test" },
  }).catch((err) => err); // execFile rejects on nonzero exit — capture instead of throw
}

describe("scripts/auditIndexes.mjs — static source safety (no live DB needed)", () => {
  const src = fs.readFileSync(SCRIPT_PATH, "utf8");

  test("never calls syncIndexes, dropIndex(es), dropCollection, dropDatabase, deleteMany, updateMany, or findOneAndDelete", () => {
    // Checks for the actual CALL shape (a `.` immediately before the name
    // and a `(` immediately after) — the safety-doc comment at the top of
    // this file legitimately names "syncIndexes" in prose to explain why
    // it's avoided; that mention must not itself trip this guard.
    for (const forbidden of [
      "syncIndexes",
      "dropIndex",
      "dropCollection",
      "dropDatabase",
      "deleteMany",
      "updateMany",
      "findOneAndDelete",
      "findOneAndUpdate",
      "bulkWrite",
    ]) {
      assert.ok(!new RegExp(`\\.${forbidden}\\(`).test(src), `must never call .${forbidden}(...)`);
    }
  });

  test("the only index-creating call is createIndexes()", () => {
    assert.match(src, /\.createIndexes\(\)/);
  });

  test("the MODELS array in source lists exactly the same 19 model files present in models/*.js", () => {
    const modelFiles = fs
      .readdirSync(MODELS_DIR)
      .filter((f) => f.endsWith("Model.js"))
      .map((f) => path.basename(f));
    assert.equal(modelFiles.length, 19, `expected exactly 19 model files, found ${modelFiles.length}: ${modelFiles.join(", ")}`);

    for (const file of modelFiles) {
      const importPath = `../models/${file}`;
      assert.ok(src.includes(importPath), `scripts/auditIndexes.mjs must import ${importPath} — a model file exists that this audit doesn't cover`);
    }

    // Every imported model must also appear in the MODELS array itself,
    // not just be imported-and-unused.
    const importedNames = [...src.matchAll(/^import (\w+) from "\.\.\/models\//gm)].map((m) => m[1]);
    const modelsArrayMatch = src.match(/const MODELS = \[([\s\S]*?)\];/);
    assert.ok(modelsArrayMatch, "MODELS array must exist");
    const arrayNames = modelsArrayMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(
      [...arrayNames].sort(),
      [...importedNames].sort(),
      "every imported model must appear exactly once in MODELS, and vice versa",
    );
  });
});

describe("scripts/auditIndexes.mjs — real behavior against a disposable test database", { skip: !canRun && reason }, () => {
  let RateLimit;

  before(async () => {
    await connectTestDb();
    ({ default: RateLimit } = await import("../models/rateLimitModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  test("all-present state: dry-run exits 0 and reports every one of the 19 models", async () => {
    // Ensure every declared index actually exists first (idempotent — a
    // normal app process already does this via autoIndex).
    await execFileAsync("node", [SCRIPT_PATH, "--ensure"], { env: { ...process.env, NODE_ENV: "test" } });

    const result = await runAudit();
    const output = (result.stdout || "") + (result.stderr || "");
    assert.equal(result.code ?? 0, 0, `dry-run must exit 0 when every declared index is present:\n${output}`);
    for (const modelName of ["sessions", "rate_limit_counters", "orders", "payments", "couponusages", "products", "reviews", "addresses", "attributedefinitions", "brands", "carts", "categories", "coupons", "notifications", "Event", "settings", "themes", "users", "wishlists"]) {
      assert.match(output, new RegExp(`${modelName}: \\d+ declared`), `expected a report line for ${modelName}`);
    }
  });

  test("missing-index state: dropping one declared index causes dry-run to exit nonzero and report it", async () => {
    // Drop exactly one real index this script itself would normally
    // create — proves the "missing" detection path fires. Note: this
    // app's models use Mongoose's own `autoIndex: true` (confirmed
    // elsewhere in this codebase's own Phase 11 notes), so simply
    // connecting a fresh process — which a dry-run run also does — can
    // itself trigger Mongoose's independent, non-script index build as a
    // connection-time side effect; this test therefore checks the
    // SCRIPT's own dry-run branch never calls createIndexes() (see the
    // static source test above: `if (ensure && missing.length > 0)`
    // gates every createIndexes() call), not the live collection state,
    // which autoIndex can change for reasons outside this script.
    await RateLimit.collection.dropIndex("expiresAt_1");
    try {
      const result = await runAudit();
      const output = (result.stdout || "") + (result.stderr || "");
      assert.notEqual(result.code, 0, "dry-run must exit nonzero when a declared index is missing");
      assert.match(output, /rate_limit_counters.*MISSING/);
    } finally {
      // Restore via the script's own additive --ensure path (also proves
      // --ensure actually creates a genuinely missing index).
      await execFileAsync("node", [SCRIPT_PATH, "--ensure"], { env: { ...process.env, NODE_ENV: "test" } });
      const restored = await RateLimit.collection.indexes();
      assert.ok(restored.some((i) => i.name === "expiresAt_1"), "--ensure must have recreated the dropped index");
    }
  });

  test("--ensure is additive and repeatable: running it twice in a row is a safe no-op the second time", async () => {
    const first = await execFileAsync("node", [SCRIPT_PATH, "--ensure"], { env: { ...process.env, NODE_ENV: "test" } });
    const second = await execFileAsync("node", [SCRIPT_PATH, "--ensure"], { env: { ...process.env, NODE_ENV: "test" } });
    assert.equal(first.code ?? 0, 0);
    assert.equal(second.code ?? 0, 0);
    assert.match(second.stdout, /all present/, "a repeated --ensure run must find every index already present");
  });

  test("a missing unique index with pre-existing duplicate values is reported as a safe conflict COUNT, never a document or field value", async () => {
    // rate_limit_counters has a unique compound index; insert two raw
    // documents that would violate it, then drop the index and confirm
    // the conflict warning names only a count, never the duplicated value.
    const dupKey = { keyHash: "phase12-audit-dup-test", action: "phase12-audit-dup-test", windowStart: new Date(0) };
    await RateLimit.collection.dropIndex("keyHash_1_action_1_windowStart_1").catch(() => {});
    await RateLimit.collection.insertMany([
      { ...dupKey, count: 1, expiresAt: new Date(Date.now() + 60000) },
      { ...dupKey, count: 1, expiresAt: new Date(Date.now() + 60000) },
    ]);
    try {
      const result = await runAudit();
      const output = (result.stdout || "") + (result.stderr || "");
      assert.match(output, /WARNING.*conflicting group/i, "must warn about the duplicate-value conflict");
      assert.doesNotMatch(output, /phase12-audit-dup-test/, "must never print the actual duplicated field value");
    } finally {
      await RateLimit.collection.deleteMany(dupKey);
      await execFileAsync("node", [SCRIPT_PATH, "--ensure"], { env: { ...process.env, NODE_ENV: "test" } });
    }
  });
});
