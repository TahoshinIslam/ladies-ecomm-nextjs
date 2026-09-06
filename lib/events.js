import mongoose from "mongoose";

import Event from "../models/eventModel.js";

// Phase 11, section I (mandatory) — replaces the old process-local
// EventEmitter bus with a MongoDB-backed durable outbox. See
// models/eventModel.js for why: Vercel runs multiple isolated function
// instances sharing no process memory, so an in-memory EventEmitter can
// never deliver an event across instances — only a durable, queryable
// record every instance can read solves that.
//
// Public API intentionally unchanged (`emitOrderEvent`, `emitAdminEvent`,
// `orderChannel`, `ADMIN_CHANNEL`) — every existing call site
// (services/orderService.js, services/paymentService.js,
// services/productService.js, services/reviewService.js) already fires
// these strictly after a successful commit (confirmed by direct
// call-site audit), so no call site's surrounding transaction/commit
// ordering needed to change — only `await` was added, since a durable
// write is now genuinely asynchronous where the old in-memory emit was
// synchronous.
const EVENT_TTL_MS = 10 * 60 * 1000; // 10 minutes — well past any realistic reconnect gap

export const orderChannel = (orderId) => `order:${orderId}`;
export const ADMIN_CHANNEL = "admin";

async function publish(channel, type, payload) {
  await Event.create({
    channel,
    type,
    payload,
    expiresAt: new Date(Date.now() + EVENT_TTL_MS),
  });
}

export async function emitOrderEvent(orderId, payload) {
  await publish(orderChannel(orderId), "ORDER_STATUS_UPDATED", payload);
}

export async function emitAdminEvent(payload) {
  await publish(ADMIN_CHANNEL, payload.type, payload);
}

// Read-side primitive shared by both SSE routes (app/api/admin/events/
// route.js, app/api/orders/[id]/events/route.js): bounded polling, never
// MongoDB Change Streams. Documented choice (Phase 11, section I): Change
// Streams require a replica set (already true here) but add a persistent
// server-side cursor/oplog-tailing connection per subscriber and a second
// class of failure modes (resume-token invalidation, cursor timeouts) —
// justified at a scale with many concurrent long-lived subscribers or a
// need for sub-second latency. This app's real usage (a handful of admin
// dashboards and individual customers watching their own order) is small
// enough that a 1s bounded poll against an indexed {channel,_id} query is
// simpler, has no separate failure mode from the rest of the app's normal
// query path, and costs one small indexed query per second per open
// stream — reconsider only if concurrent open-stream volume grows enough
// for that per-stream poll cost to matter, which is not this app's
// current scale.
export async function readEventsSince(channel, afterId, limit = 50) {
  const query = { channel };
  if (afterId) query._id = { $gt: afterId };
  return Event.find(query).sort({ _id: 1 }).limit(limit).lean();
}

// Resolves the starting cursor for a new SSE connection: a valid
// `Last-Event-ID` (already ordered ascending, so DB events strictly
// after it are new) resumes exactly where the client left off; with none
// supplied, starts from "now" (the current latest event's _id, if any) —
// a fresh connection was never going to see events older than itself
// under the old EventEmitter design either, so this preserves the same
// "live events only" semantics rather than replaying history.
export async function resolveStartCursor(channel, lastEventIdHeader) {
  if (lastEventIdHeader && mongoose.isValidObjectId(lastEventIdHeader)) {
    return new mongoose.Types.ObjectId(lastEventIdHeader);
  }
  const latest = await Event.findOne({ channel }).sort({ _id: -1 }).select("_id").lean();
  return latest?._id ?? null;
}
