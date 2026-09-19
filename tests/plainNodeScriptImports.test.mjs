// scripts/seedCatalog.mjs and scripts/runMigrations.mjs run under PLAIN Node —
// no tests/helpers/nextResolveHook.mjs — so every module they load must be
// importable without resolving "next/*" (an extensionless "next/server" import
// fails there). A model that quietly starts importing lib/db/tx.js
// (-> idempotency.js -> lib/http.js -> next/server) breaks the HTTP suite's
// reseed step and every seed script; the failure is invisible to the in-process
// tests, which install the resolve hook. This spawns a hook-free Node to prove
// the graph stays clean.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;

const MODULES = [
  "models/productModel.js",
  "models/categoryModel.js",
  "models/attributeDefinitionModel.js",
  "lib/db/transaction.js",
  "scripts/migrations/0007_repair_variant_attribute_assignments.mjs",
];

describe("modules used by plain-Node scripts import without the Next resolve hook", () => {
  for (const rel of MODULES) {
    test(rel, () => {
      const result = spawnSync(
        process.execPath,
        ["--env-file-if-exists=.env.test", "-e", `import(${JSON.stringify(new URL(rel, `file://${ROOT}`).href)}).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })`],
        { cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
      );
      assert.equal(result.status, 0, result.stderr);
    });
  }
});
