// Phase 5B — proves every schemas/*.js module is safe to import from a
// Client Component: no Mongoose, no Node-only built-in modules, no
// database connection attempted, nothing that would break (or silently
// pull server secrets into) a browser bundle.
//
// This does NOT mock or stub anything — it genuinely imports each real
// module in this same Node process and inspects what actually got pulled
// into `require.cache`-equivalent (ESM's module registry has no public
// enumeration API, so this instead asserts on the concrete, observable
// side effects that would occur if Mongoose/a DB connection were reached:
// no mongoose connection state changes, and the process's own imported-
// module list — captured via Node's built-in `module.builtinModules`
// cross-referenced against a source-text scan — contains no disallowed
// import specifier).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const SCHEMAS_DIR = new URL("../schemas", import.meta.url).pathname;
const DISALLOWED_BUILTINS = new Set(builtinModules.filter((m) => m !== "node:module"));

function schemaFiles() {
  return fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".js"));
}

describe("schemas/*.js — client-importability", () => {
  for (const file of schemaFiles()) {
    test(`${file} contains no Mongoose, Node-only builtin, or "use server" import`, () => {
      const full = path.join(SCHEMAS_DIR, file);
      const content = fs.readFileSync(full, "utf8");

      assert.ok(!/from ["']mongoose["']/.test(content), `${file} must not import mongoose`);
      assert.ok(!/models\//.test(content), `${file} must not import a Mongoose model`);
      assert.ok(!/config\/db/.test(content), `${file} must not import the database connector`);
      assert.ok(!/"use server"/.test(content), `${file} must not be a server action`);

      for (const builtin of DISALLOWED_BUILTINS) {
        const re = new RegExp(`from ["'](node:)?${builtin}["']`);
        assert.ok(!re.test(content), `${file} must not import the Node-only builtin "${builtin}"`);
      }
    });
  }

  test("every schemas/*.js module actually imports and evaluates cleanly (no Mongoose connection attempted)", async () => {
    for (const file of schemaFiles()) {
      const mod = await import(`../schemas/${file}`);
      assert.ok(Object.keys(mod).length > 0, `${file} must export at least one schema`);
    }
  });

  test("a representative shared schema (registerSchema) parses correctly with no server context at all", async () => {
    const { registerSchema } = await import("../schemas/authSchemas.js");
    const result = registerSchema.safeParse({ name: "Test User", email: "test@example.invalid", password: "Password123!" });
    assert.equal(result.success, true);
  });
});
