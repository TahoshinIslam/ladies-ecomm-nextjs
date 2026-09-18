import Event from "../models/eventModel.js";
import { logEvent, FAILURE_CATEGORIES } from "./logger.js";

// Phase 11, section I (mandatory) — replaces the old process-local
// EventEmitter bus with a MongoDB-backed durable outbox. See
// models/eventModel.js for why: Vercel runs multiple isolated function
// instances sharing no process memory, so an in-memory EventEmitter can
// never deliver an event across instances — only a durable, queryable
// record every instance can read solves that.
//
// Phase 11 CORRECTION (realtime-durability closure): the original version
// of this file always wrote the event as an independent, fire-and-forget
// write (`.catch(() => {})`, never awaited by the caller before it
// returned). That has two real problems on a serverless platform: (1) a
// Vercel Function can return its response and have its instance frozen
// before an un-awaited promise settles, meaning the event write might
// never actually happen even though the business mutation succeeded; (2)
// swallowing the failure silently removed all operational visibility into
// a lost event.
//
// The fix has two parts, chosen per call site (see the exact
// classification in docs/PRODUCTION_READINESS.md's realtime-durability
// section and the audit below):
//   - For a mutation that already runs inside a MongoDB transaction
//     (order creation, order cancellation, COD payment creation): the
//     event document is now inserted INSIDE that same transaction, via
//     the optional `{ session }` passed to emitOrderEvent/emitAdminEvent
//     below. This makes it a genuine transactional outbox for those three
//     mutations — if the event insert fails, the whole transaction
//     (business mutation included) rolls back; if the transaction commits,
//     the event is durably visible in the same atomic instant. Nothing
//     else needs to "expose the event after commit" — the SSE routes only
//     ever see committed data anyway, since they poll via an independent
//     read (MongoDB transactions are only visible to other readers once
//     committed).
//   - For a mutation that is NOT transactional (product create/update, a
//     new review, a low-stock check, an order status change with no
//     surrounding transaction): the event write is still awaited before
//     the caller's function returns (via emitBestEffort below), but a
//     failure there is logged — never silently thrown away — and does
//     NOT fail the primary mutation. This is a deliberate, documented
//     policy (Section J of the ADR): every one of these event types has a
//     low-severity, self-healing loss consequence (a live UI staying
//     stale until the next poll/refresh), so failing an otherwise-
//     successful product save/review/status-change over a realtime
//     notification would be the wrong tradeoff. What changed from before
//     is only that the write is no longer silently unawaited — a failure
//     is now guaranteed to be observed and logged before the response
//     returns, not lost to a frozen/recycled function instance.
const EVENT_TTL_MS = 10 * 60 * 1000; // 10 minutes — well past any realistic reconnect gap

export const orderChannel = (orderId) => `order:${orderId}`;
export const ADMIN_CHANNEL = "admin";
// One channel per customer — their own order-status/delivery
// notifications (see notificationService.js's createUserNotification),
// never broadcast to anyone else. Same shape as orderChannel/ADMIN_CHANNEL
// above; readEventsSince()/resolveStartCursor() already work on any
// channel string, so this needed no new durability/polling mechanism.
export const userChannel = (userId) => `user:${userId}`;

async function publish(channel, type, payload, { session } = {}) {
  // `session` here is actually a raw mysql2 PoolConnection (kept the same
  // option name as the old Mongoose call sites passed, `{ session }`, so
  // every emitOrderEvent/emitAdminEvent/emitUserEvent call site inside a
  // withTransaction() callback needed no change beyond what it already
  // passes).
  return Event.create({ channel, type, payload, expiresAt: new Date(Date.now() + EVENT_TTL_MS) }, session);
}

/**
 * Writes the durable ORDER_STATUS_UPDATED event. Pass `{ session }` when
 * called from inside an active `session.withTransaction(...)` callback —
 * the write then joins that transaction and is rolled back with it on
 * failure. Omit `session` for a non-transactional call site; wrap the
 * call in emitBestEffort() below in that case so a failure is logged
 * rather than thrown or silently dropped.
 */
export async function emitOrderEvent(orderId, payload, opts) {
  return publish(orderChannel(orderId), "ORDER_STATUS_UPDATED", payload, opts);
}

/**
 * Writes a durable admin-channel event. Same `{ session }` contract as
 * emitOrderEvent above.
 */
export async function emitAdminEvent(payload, opts) {
  return publish(ADMIN_CHANNEL, payload.type, payload, opts);
}

/**
 * Writes a durable event on one customer's own channel — the realtime half
 * of createUserNotification() (services/notificationService.js): a
 * `NEW_NOTIFICATION` event here is what lets that customer's open tab
 * refresh their bell immediately instead of waiting for the next poll.
 * Same `{ session }` contract as emitOrderEvent above.
 */
export async function emitUserEvent(userId, payload, opts) {
  return publish(userChannel(userId), payload.type, payload, opts);
}

/**
 * Awaits a non-transactional emit call, logging (never throwing) on
 * failure — the caller's own mutation has already succeeded and must not
 * fail because a best-effort realtime notification couldn't be written.
 * Never used for a transactional emit (those are awaited directly inside
 * the transaction callback, with no catch, so a real failure aborts the
 * whole transaction as intended).
 */
export async function emitBestEffort(promise) {
  try {
    await promise;
  } catch (err) {
    // No requestId is available at this service-layer depth (these are
    // plain service functions, not Route Handlers) — lib/http.js's own
    // withRoute already logs a categorized, request-ID-correlated line
    // for the response if this ever propagated as a thrown error, but it
    // deliberately does not here (that's the whole point of catching it).
    // This line's own `event`/`category` fields still give an
    // operator something to alert on, per lib/logger.js's allowlist.
    logEvent({ event: "event_publish_failed", category: FAILURE_CATEGORIES.DEPENDENCY_UNAVAILABLE });
    console.error("event publish failed (best-effort, business mutation already succeeded)", err);
  }
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
  return Event.findSince(channel, afterId || null, limit);
}

// Resolves the starting cursor for a new SSE connection: a valid
// `Last-Event-ID` (already ordered ascending, so DB events strictly
// after it are new) resumes exactly where the client left off; with none
// supplied, starts from "now" (the current latest event's _id, if any) —
// a fresh connection was never going to see events older than itself
// under the old EventEmitter design either, so this preserves the same
// "live events only" semantics rather than replaying history.
//
// Phase 12 remediation: a supplied Last-Event-ID is now verified to
// actually exist IN THIS CHANNEL (via a real DB read) before being trusted
// as the resume point — previously a well-formed-but-nonexistent/
// deleted/foreign-channel id was accepted blindly (harmless in practice,
// since the channel filter still scoped every subsequent read, but never
// verified). A resume attempt whose DB read genuinely fails (a transient
// error, not "not found") now propagates the error to the caller instead
// of being silently swallowed — the caller must fail closed (never
// silently reinterpret a failed resume as "replay from the beginning").
export async function resolveStartCursor(channel, lastEventIdHeader) {
  // Event ids are now plain AUTO_INCREMENT integers (see models/eventModel.js),
  // not ObjectId hex strings — `Last-Event-ID` is opaque to the browser
  // either way, so this format change needs no client-side handling.
  const id = Number(lastEventIdHeader);
  if (lastEventIdHeader && Number.isInteger(id) && id > 0) {
    const exists = await Event.existsInChannel(id, channel);
    if (exists) return id;
    // Not found (already cleaned up, deleted, or from a different channel)
    // — safe, documented fallback: treat exactly like a brand-new
    // subscription (live events only), never a history replay.
  }
  return Event.findLatestId(channel);
}
