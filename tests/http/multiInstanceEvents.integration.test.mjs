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
//   5. A failed/rejected mutation (schema validation failure) emits no
//      event at all.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser, createTestProduct } from "../helpers/testDb.mjs";

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
  let admin, customer, product, order, adminAuth, customerAuth, Order, Event;

  before(async () => {
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ default: Event } = await import("../../models/eventModel.js"));

    admin = await createTestUser({ role: "admin" });
    customer = await createTestUser({ role: "customer" });
    product = await createTestProduct({ stock: 10 });
    order = await Order.create({
      user: customer._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 1000 } }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
      subtotal: 1000,
      total: 1000,
      status: "processing",
    });

    adminAuth = await cookieHeaderFor(admin._id);
    customerAuth = await cookieHeaderFor(customer._id);
  });

  after(async () => {
    if (dbConnectable) {
      await Order.deleteMany({ _id: order?._id });
      await Event.deleteMany({});
      await disconnectTestDb();
    }
  });

  test("an event committed via a real request to INSTANCE A is delivered to a stream connected to INSTANCE B (cross-process proof)", async () => {
    const streamRes = await fetch(`${BASE_B}/api/orders/${order._id}/events`, {
      headers: { cookie: customerAuth.cookie },
    });
    assert.equal(streamRes.status, 200);

    const framesPromise = collectFramesUntil(streamRes, (f) => f.event === "ORDER_STATUS_UPDATED");

    // The commit happens on INSTANCE A — a completely separate process
    // from the one instance B's stream is polling against. Only a
    // durable, shared record (not process memory) can bridge this.
    const updateRes = await fetch(`${BASE_A}/api/orders/${order._id}/status`, {
      method: "PUT",
      headers: { cookie: adminAuth.cookie, "content-type": "application/json", origin: BASE_A, "x-csrf-token": adminAuth.csrf },
      body: JSON.stringify({ status: "shipped" }),
    });
    assert.equal(updateRes.status, 200, "the status-update request to instance A must itself succeed");

    const frames = await framesPromise;
    const statusFrame = frames.find((f) => f.event === "ORDER_STATUS_UPDATED");
    assert.ok(statusFrame, "instance B's stream must have received the ORDER_STATUS_UPDATED event committed via instance A");
    const payload = JSON.parse(statusFrame.data);
    assert.equal(payload.status, "shipped");
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
    // Establish a fresh connection, capture one real event's id.
    const firstRes = await fetch(`${BASE_B}/api/orders/${order._id}/events`, { headers: { cookie: customerAuth.cookie } });
    const firstFramesPromise = collectFramesUntil(firstRes, (f) => f.event === "ORDER_STATUS_UPDATED");
    await fetch(`${BASE_A}/api/orders/${order._id}/status`, {
      method: "PUT",
      headers: { cookie: adminAuth.cookie, "content-type": "application/json", origin: BASE_A, "x-csrf-token": adminAuth.csrf },
      body: JSON.stringify({ status: "delivered" }),
    });
    const firstFrames = await firstFramesPromise;
    const firstEventFrame = firstFrames.find((f) => f.event === "ORDER_STATUS_UPDATED");
    assert.ok(firstEventFrame?.id);

    // Reconnect with that id as Last-Event-ID, with no new event yet —
    // must NOT redeliver the one we already saw.
    const resumeRes = await fetch(`${BASE_B}/api/orders/${order._id}/events`, {
      headers: { cookie: customerAuth.cookie, "last-event-id": firstEventFrame.id },
    });
    const resumeFramesPromise = collectFramesUntil(resumeRes, (f) => f.event === "ORDER_STATUS_UPDATED", 3000);
    const framesBeforeNewCommit = await resumeFramesPromise;
    assert.ok(
      !framesBeforeNewCommit.some((f) => f.id === firstEventFrame.id),
      "a resumed connection must never redeliver an event at or before Last-Event-ID",
    );

    // Now commit a genuinely new status change and confirm THIS resumed
    // connection (still open, from the same reconnect) still gets it —
    // re-open since the prior collect call already consumed/cancelled it.
    const secondRes = await fetch(`${BASE_B}/api/orders/${order._id}/events`, {
      headers: { cookie: customerAuth.cookie, "last-event-id": firstEventFrame.id },
    });
    const secondFramesPromise = collectFramesUntil(secondRes, (f) => f.event === "ORDER_STATUS_UPDATED");
    await fetch(`${BASE_A}/api/orders/${order._id}/status`, {
      method: "PUT",
      headers: { cookie: adminAuth.cookie, "content-type": "application/json", origin: BASE_A, "x-csrf-token": adminAuth.csrf },
      body: JSON.stringify({ status: "refunded" }), // valid transition from "delivered" (see services/orderService.js's ORDER_STATUS_TRANSITIONS)
    });
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

    const countAfterFirst = await Event.countDocuments({ channel: "admin", type: "NEW_ORDER", "payload.orderId": newOrderId });
    assert.equal(countAfterFirst, 1);

    const second = await makeRequest();
    assert.equal(second.status, 200, "a replayed idempotent request must still succeed (returning the same order) with the documented 200 replay status");
    const secondBody = await second.json();
    assert.equal(secondBody.order._id, newOrderId, "replay must return the SAME order, not create a second one");

    const countAfterReplay = await Event.countDocuments({ channel: "admin", type: "NEW_ORDER", "payload.orderId": newOrderId });
    assert.equal(countAfterReplay, 1, "a replayed idempotent request must not create a second NEW_ORDER event");

    await Order.deleteOne({ _id: newOrderId });
  });

  test("a rejected mutation (schema validation failure) emits no event at all", async () => {
    const beforeCount = await Event.countDocuments({ channel: `order:${order._id}` });

    const res = await fetch(`${BASE_A}/api/orders/${order._id}/status`, {
      method: "PUT",
      headers: { cookie: adminAuth.cookie, "content-type": "application/json", origin: BASE_A, "x-csrf-token": adminAuth.csrf },
      body: JSON.stringify({ status: "not-a-real-status" }),
    });
    assert.equal(res.status, 400, "an invalid status value must be rejected before any event is emitted");

    const afterCount = await Event.countDocuments({ channel: `order:${order._id}` });
    assert.equal(afterCount, beforeCount, "a rejected mutation must never write an Event document");
  });
});
