// Phase 11 — static proofs that docs/PRODUCTION_READINESS.md exists, is
// substantive, and never claims a live/deployment-only check as verified.
// Same house style as tests/errorBoundaryArchitecture.test.mjs: source-text
// inspection, not opinion.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DOC_PATH = new URL("../docs/PRODUCTION_READINESS.md", import.meta.url);

describe("Phase 11 — docs/PRODUCTION_READINESS.md exists and is substantive", () => {
  test("file exists", () => {
    assert.ok(fs.existsSync(DOC_PATH));
  });

  const content = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, "utf8") : "";

  test("contains an architecture classification table", () => {
    assert.match(content, /\|\s*Concern\s*\|\s*Mechanism\s*\|/i);
    for (const row of ["Load balancing", "Sessions", "Rate limiting", "Idempotency", "Realtime", "DB topology", "Sharding", "Backups", "Monitoring"]) {
      assert.match(content, new RegExp(row, "i"), `classification table must cover "${row}"`);
    }
  });

  test("contains a Mermaid architecture diagram", () => {
    assert.match(content, /```mermaid/);
    assert.match(content, /flowchart/);
  });

  test("documents the load-balancer decision and why sticky sessions are unnecessary", () => {
    assert.match(content, /no custom load balancer/i);
    assert.match(content, /sticky sessions/i);
  });

  test("documents an explicit, evidence-based sharding decision (not silence on the topic)", () => {
    assert.match(content, /not sharded/i);
    assert.match(content, /shard key/i);
  });

  test("documents the async-work decision table (no queue required now) with explicit future thresholds", () => {
    assert.match(content, /no message queue\/broker required/i);
    assert.match(content, /future adoption thresholds/i);
  });

  test("documents a backup\\/PITR plan and a restore-drill procedure that never restores over production", () => {
    assert.match(content, /point-in-time recovery|PITR/i);
    assert.match(content, /never restor(e|ing)[^.]* over[^.]*production|never touches the source\s*cluster/i);
  });

  test("documents a deployment/rollback runbook", () => {
    assert.match(content, /rollback steps/i);
    assert.match(content, /production promotion steps/i);
  });

  test("never claims a live-only check is verified — every PENDING gate is explicitly marked PENDING, not PASS", () => {
    assert.match(content, /PENDING/);
    // Every literal "PASS" in the doc must appear only inside a negated
    // phrase ("may not be marked PASS", "never ... PASS") — never as a
    // bare, affirmative claim that a live gate has passed.
    const passMentions = content.match(/.{0,40}PASS.{0,10}/g) || [];
    for (const mention of passMentions) {
      assert.match(mention, /not\b|never|none|cannot/i, `found an unqualified "PASS" mention: "${mention}"`);
    }
  });

  test("lists at least 16 live-verification gates as PENDING", () => {
    const section = content.slice(content.indexOf("Live-verification gates"));
    const numberedItems = section.match(/^\d+\./gm) || [];
    assert.ok(numberedItems.length >= 16, `expected at least 16 numbered PENDING gates, found ${numberedItems.length}`);
  });

  test("never prints/describes an actual MONGO_URI value (only says how to find the region via a dashboard)", () => {
    assert.ok(!/mongodb(\+srv)?:\/\/[^\s)]*@/.test(content), "must never embed a credentialed connection string");
  });
});
