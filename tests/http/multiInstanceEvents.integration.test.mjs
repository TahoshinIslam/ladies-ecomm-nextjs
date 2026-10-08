// Phase 11, section I (MANDATORY) — the one piece of evidence that
// actually proves the point of this whole section: that the MongoDB-backed
// durable event outbox (lib/events.js, models/eventModel.js) delivers an
// event across two INDEPENDENT, real server processes, which the old
// process-local EventEmitter design structurally could not do (Vercel runs
// multiple isolated function instances sharing no process memory).
//
// Run via: node scripts/multiInstanceHttpTestServer.mjs run
// (that script spawns two real `next start` processes — instance A on
// HTTP_TEST_BASE_URL_A, instance B on HTTP_TEST_BASE_URL_B — both pointed
// at the SAME disposable test database, then runs this file with both
// base URLs set as env vars).
//
// What this proves, one test per required property:
//   1. An SSE client connected to INSTANCE B receives an event committed
//      by a real HTTP request to INSTANCE A (the actual cross-process
//      proof).
//   2. An unauthorized client gets no data from the stream at all.
//   3. `Last-Event-ID` resume: a reconnect with a prior event's id never
//      redelivers it, and does deliver a later one.
//   4. Duplicate replay (same Idempotency-Key) does not duplicate the
//      underlying Event documents.
//   5. A failed/rejected mutation (a forbidden status change) emits no
//      event at all.
//
// The admin order screens and API were removed from the storefront (the dashboard owns administration), so the requests that
// change an order are the customer's own: cancel. Properties 1, 3 and 5 are driven through it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser, createTestProduct, deleteRows, rawQuery } from "../helpers/testDb.mjs";

// events.payload is a MySQL JSON column (no Mongo-style dot-path filter
// support in models/eventModel.js — it only exposes the channel-scoped
// reads real service code needs, see models/README-migration.md) — this
// test file's own fixture-verification counts go straight through SQL's
// native JSON_EXTRACT, the same "test-only SQL escape hatch" pattern
// tests/helpers/testDb.mjs's rawQuery() exists for.
async function countEvents({ channel, type, orderId }) {
  const clauses = ["channel = ?"];
  const params = [channel];
  if (type) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (orderId) {
    clauses.push("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.orderId')) = ?");
    params.push(orderId);
  }
  const rows = await rawQuery(`SELECT COUNT(*) AS n FROM storefront_events WHERE ${clauses.join(" AND ")}`, params);
  return Number(rows[0].n);
}

const BASE_A = process.env.HTTP_TEST_BASE_URL_A;
const BASE_B = process.env.HTTP_TEST_BASE_URL_B;

let serversUp = false;
if (BASE_A && BASE_B) {
  try {
    const [a, b] = await Promise.all([fetch(`${BASE_A}/api/health/live`), fetch(`${BASE_B}/api/health/live`)]);
    serversUp = a.ok && b.ok;
  } catch {
    serversUp = false;
  }
}

let dbConnectable = false;
if (serversUp && dbReady) {
  try {
    await connectTestDb();
    dbConnectable = true;
  } catch {
    dbConnectable = false;
  }
}

const skip = !serversUp
  ? "run via `node scripts/multiInstanceHttpTestServer.mjs run` (needs HTTP_TEST_BASE_URL_A/B, two real server instances)"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable"
    : false;

async function cookieHeaderFor(userId) {
  const { createSession } = await import("../../lib/session.js");
  const session = await createSession(userId, { userAgent: "phase11-multi-instance-suite" });
  return {
    cookie: `__Host-tahos_session=${session.rawToken}; tahos_csrf=${session.rawCsrfToken}`,
    csrf: session.rawCsrfToken,
  };
}

// A tiny incremental SSE frame parser good enough for this test's needs:
// reads raw bytes off a fetch Response's stream and yields
// {id, event, data} objects as full "\n\n"-terminated frames arrive.
async function* readSseFrames(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!rawFrame || rawFrame.startsWith(":")) continue; // heartbeat comment
      const frame = { id: null, event: null, data: null };
      for (const line of rawFrame.split("\n")) {
        if (line.startsWith("id: ")) frame.id = line.slice(4);
        else if (line.startsWith("event: ")) frame.event = line.slice(7);
        else if (line.startsWith("data: ")) frame.data = line.slice(6);
      }
      yield frame;
    }
  }
}

async function collectFramesUntil(response, predicate, timeoutMs = 8000) {
  const frames = [];
  const reader = response.body.getReader();
  const timer = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    for await (const frame of readSseFrames(reader)) {
      frames.push(frame);
      if (predicate(frame)) break;
    }
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
  return frames;
}

describe("Phase 11 (MANDATORY) — cross-process realtime delivery via the durable event outbox", { skip }, () => {
  let customer, product, order, customerAuth, Order, withTransaction, emitOrderEvent;
  const extraOrders = [];

  // An order owned by `customer` in the given status. The admin order screens were removed from the storefront, so the only requests
  // left that change an order — and emit its event — are the customer's own (cancel); the tests drive those.
  const makeOrder = (status) =>
    withTransaction((conn) =>
      Order.create(
        {
          user: customer._id,
          items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 1000 } }],
          shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
          subtotal: 1000,
          total: 1000,
          status,
          idempotencyKeyHash: crypto.randomBytes(16).toString("hex"),
          idempotencyRequestHash: crypto.randomBytes(16).toString("hex"),
        },
        conn,
      ),
    );
  const cancelViaInstanceA = (orderId, auth = customerAuth) =>
    fetch(`${BASE_A}/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json", origin: BASE_A, "x-csrf-token": auth.csrf },
      body: "{}",
    });

  before(async () => {
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ withTransaction } = await import("../../lib/db/tx.js"));
    ({ emitOrderEvent } = await import("../../lib/events.js"));

    customer = await createTestUser({ role: "customer" });
    product = await createTestProduct({ stock: 10 });
    order = await makeOrder("processing");
    customerAuth = await cookieHeaderFor(customer._id);
  });

  after(async () => {
    if (dbConnectable) {
      if (order?._id) await deleteRows("orders", "id", order._id);
      for (const id of extraOrders) await deleteRows("orders", "id", id);
      await rawQuery("DELETE FROM storefront_events");
      await disconnectTestDb();
    }
  });

  test("an event committed via a real request to INSTANCE A is delivered to a stream connected to INSTANCE B (cross-process proof)", async () => {
    const fresh = await makeOrder("processing");
    extraOrders.push(fresh._id);
    const streamRes = await fetch(`${BASE_B}/api/orders/${fresh._id}/events`, {
      headers: { cookie: customerAuth.cookie },
    });
    assert.equal(streamRes.status, 200);

    const framesPromise = collectFramesUntil(streamRes, (f) => f.event === "ORDER_STATUS_UPDATED");

    // The commit happens on INSTANCE A — a completely separate process
    // from the one instance B's stream is polling against. Only a
    // durable, shared record (not process memory) can bridge this.
    const cancelRes = await cancelViaInstanceA(fresh._id);
    assert.equal(cancelRes.status, 200, "the cancel request to instance A must itself succeed");

    const frames = await framesPromise;
    const statusFrame = frames.find((f) => f.event === "ORDER_STATUS_UPDATED");
    assert.ok(statusFrame, "instance B's stream must have received the ORDER_STATUS_UPDATED event committed via instance A");
    const payload = JSON.parse(statusFrame.data);
    assert.equal(payload.status, "cancelled");
    assert.ok(statusFrame.id, "the frame must carry an `id:` field for Last-Event-ID resume");
  });

  test("an unauthorized request to the stream receives no live connection at all", async () => {
    const res = await fetch(`${BASE_B}/api/orders/${order._id}/events`);
    assert.ok(res.status === 401 || res.status === 403, "an unauthenticated request must be rejected before the stream opens");
  });

  test("a different customer (not the order owner, not admin) is rejected", async () => {
    const other = await createTestUser({ role: "customer" });
    const otherAuth = await cookieHeaderFor(other._id);
    const res = await fetch(`${BASE_B}/api/orders/${order._id}/events`, { headers: { cookie: otherAuth.cookie } });
    assert.equal(res.status, 403);
  });

  test("Last-Event-ID resume: reconnecting with a prior event's id never redelivers it, and does deliver a new one", async () => {
    const fresh = await makeOrder("processing");
    extraOrders.push(fresh._id);
    // Establish a fresh connection, capture one real event's id — committed by a real request to instance A.
    const firstRes = await fetch(`${BASE_B}/api/orders/${fresh._id}/events`, { headers: { cookie: customerAuth.cookie } });
    const firstFramesPromise = collectFramesUntil(firstRes, (f) => f.event === "ORDER_STATUS_UPDATED");
    assert.equal((await cancelViaInstanceA(fresh._id)).status, 200);
    const firstFrames = await firstFramesPromise;
    const firstEventFrame = firstFrames.find((f) => f.event === "ORDER_STATUS_UPDATED");
    assert.ok(firstEventFrame?.id);

    // Reconnect with that id as Last-Event-ID, with no new event yet —
    // must NOT redeliver the one we already saw.
    const resumeRes = await fetch(`${BASE_B}/api/orders/${fresh._id}/events`, {
      headers: { cookie: customerAuth.cookie, "last-event-id": firstEventFrame.id },
    });
    const resumeFramesPromise = collectFramesUntil(resumeRes, (f) => f.event === "ORDER_STATUS_UPDATED", 3000);
    const framesBeforeNewCommit = await resumeFramesPromise;
    assert.ok(
      !framesBeforeNewCommit.some((f) => f.id === firstEventFrame.id),
      "a resumed connection must never redeliver an event at or before Last-Event-ID",
    );

    // A genuinely new event. An order can only be cancelled once, so this one is written to the shared outbox directly from the test
    // process (a third process) — exactly what a later status change from another instance would leave there. Instance B's stream
    // must still deliver it to a connection that resumed from the first event's id.
    const secondRes = await fetch(`${BASE_B}/api/orders/${fresh._id}/events`, {
      headers: { cookie: customerAuth.cookie, "last-event-id": firstEventFrame.id },
    });
    const secondFramesPromise = collectFramesUntil(secondRes, (f) => f.event === "ORDER_STATUS_UPDATED");
    await withTransaction((conn) => emitOrderEvent(fresh._id.toString(), { orderId: fresh._id.toString(), status: "refunded" }, { session: conn }));
    const secondFrames = await secondFramesPromise;
    const secondEventFrame = secondFrames.find((f) => f.event === "ORDER_STATUS_UPDATED");
    assert.ok(secondEventFrame, "a resumed connection must still deliver a genuinely new event");
    assert.notEqual(secondEventFrame.id, firstEventFrame.id);
  });

  test("duplicate replay (same Idempotency-Key) does not duplicate the underlying Event documents", async () => {
    const idempotencyKey = `phase11-multi-instance-${Date.now()}`;
    const orderBody = {
      items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
    };

    const makeRequest = () =>
      fetch(`${BASE_A}/api/orders`, {
        method: "POST",
        headers: {
          cookie: customerAuth.cookie,
          "content-type": "application/json",
          origin: BASE_A,
          "x-csrf-token": customerAuth.csrf,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(orderBody),
      });

    const first = await makeRequest();
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    const newOrderId = firstBody.order._id;

    const countAfterFirst = await countEvents({ channel: "admin", type: "NEW_ORDER", orderId: newOrderId });
    assert.equal(countAfterFirst, 1);

    const second = await makeRequest();
    assert.equal(second.status, 200, "a replayed idempotent request must still succeed (returning the same order) with the documented 200 replay status");
    const secondBody = await second.json();
    assert.equal(secondBody.order._id, newOrderId, "replay must return the SAME order, not create a second one");

    const countAfterReplay = await countEvents({ channel: "admin", type: "NEW_ORDER", orderId: newOrderId });
    assert.equal(countAfterReplay, 1, "a replayed idempotent request must not create a second NEW_ORDER event");

    await deleteRows("orders", "id", newOrderId);
  });

  test("a rejected mutation (a forbidden status change) emits no event at all", async () => {
    // A delivered order cannot be cancelled: the transition is refused before anything is written.
    const done = await makeOrder("delivered");
    extraOrders.push(done._id);
    const beforeCount = await countEvents({ channel: `order:${done._id}` });

    const res = await cancelViaInstanceA(done._id);
    assert.ok(res.status >= 400 && res.status < 500, `a forbidden cancel must be refused with a client error (got ${res.status})`);

    const afterCount = await countEvents({ channel: `order:${done._id}` });
    assert.equal(afterCount, beforeCount, "a rejected mutation must never write an Event document");
  });
});
