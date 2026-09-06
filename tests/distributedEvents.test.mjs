// Phase 11, section I (mandatory) — DB-backed unit evidence for the
// MongoDB-backed durable event outbox (models/eventModel.js, lib/events.js)
// that doesn't require two separate server processes (that proof lives in
// tests/http/multiInstanceEvents.integration.test.mjs, run via
// `npm run test:multi-instance`). This file proves the outbox's own
// read/write primitives directly: TTL configuration, cursor semantics,
// channel isolation, and that the public API shape stayed the same.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Phase 11 — lib/events.js no longer uses a process-local EventEmitter", () => {
  const content = stripComments(fs.readFileSync(new URL("../lib/events.js", import.meta.url), "utf8"));

  test("does not import node:events / EventEmitter", () => {
    assert.ok(!/from ["']events["']/.test(content));
    assert.ok(!/EventEmitter/.test(content));
  });

  test("imports the durable Event model", () => {
    assert.match(content, /from ["']\.\.\/models\/eventModel\.js["']/);
  });

  test("keeps the same public function names every call site already imports", () => {
    for (const name of ["emitOrderEvent", "emitAdminEvent", "orderChannel", "ADMIN_CHANNEL", "readEventsSince", "resolveStartCursor"]) {
      assert.match(content, new RegExp(`export (async )?function ${name}\\b|export const ${name}\\b`));
    }
  });
});

describe("Phase 11 — every call site awaits/handles the now-async emit functions", () => {
  const files = ["services/orderService.js", "services/paymentService.js", "services/productService.js", "services/reviewService.js"];
  for (const rel of files) {
    test(`${rel}'s emit call sites are followed by .catch (never an unhandled rejection)`, () => {
      const content = stripComments(fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
      const calls = content.match(/emit(Order|Admin)Event\([\s\S]*?\)\.catch/g) || [];
      const bareCalls = (content.match(/emit(Order|Admin)Event\(/g) || []).length;
      assert.ok(bareCalls > 0, `${rel} should still call an emit function`);
      assert.equal(calls.length, bareCalls, `every emit call in ${rel} must be followed by .catch(...)`);
    });
  }
});

describe("Phase 11 — models/eventModel.js TTL and index shape", () => {
  const content = fs.readFileSync(new URL("../models/eventModel.js", import.meta.url), "utf8");

  test("declares an expiresAt TTL field matching the sessionModel/rateLimitModel pattern", () => {
    assert.match(content, /expiresAt:\s*\{\s*type:\s*Date,\s*required:\s*true,\s*index:\s*\{\s*expires:\s*0\s*\}/);
  });

  test("declares a {channel, _id} compound index for the polling query", () => {
    assert.match(content, /eventSchema\.index\(\{\s*channel:\s*1,\s*_id:\s*1\s*\}\)/);
  });
});

describe("Phase 11 — SSE routes read the durable outbox, not an in-memory bus", { skip: false }, () => {
  for (const rel of ["app/api/admin/events/route.js", "app/api/orders/[id]/events/route.js"]) {
    test(`${rel} imports readEventsSince/resolveStartCursor from lib/events.js`, () => {
      const content = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      assert.match(content, /readEventsSince/);
      assert.match(content, /resolveStartCursor/);
      assert.ok(!/eventBus/.test(content), `${rel} must not reference the removed process-local eventBus`);
    });

    test(`${rel} closes the stream before an open-ended lifetime (self-imposed STREAM_MAX_MS)`, () => {
      const content = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      assert.match(content, /STREAM_MAX_MS/);
    });

    test(`${rel} sends an SSE \`id:\` field for Last-Event-ID resume`, () => {
      const content = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      assert.match(content, /id:\s*\$\{id\}/);
    });
  }
});

describe("Phase 11 — readEventsSince / resolveStartCursor real DB behavior", { skip: !canRun && reason }, () => {
  let Event, readEventsSince, resolveStartCursor, orderChannel, ADMIN_CHANNEL;

  before(async () => {
    await connectTestDb();
    ({ default: Event } = await import("../models/eventModel.js"));
    ({ readEventsSince, resolveStartCursor, orderChannel, ADMIN_CHANNEL } = await import("../lib/events.js"));
  });

  after(async () => {
    await Event.deleteMany({ channel: /^phase11-distributed-events-test/ });
    await disconnectTestDb();
  });

  test("readEventsSince only returns events on the requested channel, never another channel's events", async () => {
    const channelA = "phase11-distributed-events-test:a";
    const channelB = "phase11-distributed-events-test:b";
    await Event.create({ channel: channelA, type: "X", payload: {}, expiresAt: new Date(Date.now() + 60000) });
    await Event.create({ channel: channelB, type: "Y", payload: {}, expiresAt: new Date(Date.now() + 60000) });

    const eventsA = await readEventsSince(channelA, null);
    assert.ok(eventsA.every((e) => e.channel === channelA));
    assert.ok(eventsA.some((e) => e.type === "X"));
    assert.ok(!eventsA.some((e) => e.type === "Y"));
  });

  test("readEventsSince with afterId only returns strictly-later events (no redelivery)", async () => {
    const channel = "phase11-distributed-events-test:cursor";
    const first = await Event.create({ channel, type: "FIRST", payload: {}, expiresAt: new Date(Date.now() + 60000) });
    const second = await Event.create({ channel, type: "SECOND", payload: {}, expiresAt: new Date(Date.now() + 60000) });

    const afterFirst = await readEventsSince(channel, first._id);
    assert.equal(afterFirst.length, 1);
    assert.equal(afterFirst[0].type, "SECOND");

    const afterSecond = await readEventsSince(channel, second._id);
    assert.equal(afterSecond.length, 0);
  });

  test("resolveStartCursor with a valid Last-Event-ID resumes from exactly that id, without querying for 'latest'", async () => {
    const channel = "phase11-distributed-events-test:resume";
    const ev = await Event.create({ channel, type: "X", payload: {}, expiresAt: new Date(Date.now() + 60000) });
    const cursor = await resolveStartCursor(channel, ev._id.toString());
    assert.equal(cursor.toString(), ev._id.toString());
  });

  test("resolveStartCursor with no Last-Event-ID starts from the current latest event (skips history)", async () => {
    const channel = "phase11-distributed-events-test:fresh";
    const older = await Event.create({ channel, type: "OLD", payload: {}, expiresAt: new Date(Date.now() + 60000) });
    const cursor = await resolveStartCursor(channel, null);
    assert.equal(cursor.toString(), older._id.toString());

    const events = await readEventsSince(channel, cursor);
    assert.equal(events.length, 0, "a fresh connection must not see history that existed before it connected");
  });

  test("orderChannel()/ADMIN_CHANNEL produce the expected channel strings", () => {
    assert.equal(orderChannel("abc123"), "order:abc123");
    assert.equal(ADMIN_CHANNEL, "admin");
  });
});
