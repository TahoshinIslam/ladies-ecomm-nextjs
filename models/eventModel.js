import mongoose from "mongoose";

// Phase 11, section I — the durable, cross-process replacement for the old
// process-local EventEmitter bus (lib/events.js). Vercel Fluid Compute runs
// multiple isolated function instances that share no process memory — an
// EventEmitter living in one instance's memory is invisible to every other
// instance, so a client whose SSE connection happens to land on instance B
// would never hear an event emitted from instance A. Every event this app
// needs to broadcast is instead written here first (a durable, queryable
// record every instance can read), and the SSE routes poll it.
//
// TTL pattern matches models/sessionModel.js / models/rateLimitModel.js
// exactly: `expiresAt` with `index: { expires: 0 }` lets MongoDB's own
// background task remove the document once it's no longer needed — an
// event only needs to live long enough for an SSE client's own bounded
// polling loop (and a brief reconnect window) to pick it up.
const eventSchema = new mongoose.Schema({
  // "admin" (the whole staff broadcast channel) or `order:<orderId>` (one
  // customer's order) — see orderChannel()/ADMIN_CHANNEL below. Never a
  // free-form string from user input; always constructed by this module.
  channel: { type: String, required: true },
  // The SSE event name the client's EventSource.addEventListener() name
  // matches against (e.g. "NEW_ORDER", "ORDER_STATUS_UPDATED").
  type: { type: String, required: true },
  // Minimal payload only — never a full Mongoose document, never a
  // secret/token/payment detail. Every existing call site already only
  // ever passed small, purpose-built objects (ids, statuses, names) — this
  // schema doesn't change what's allowed to be sent, only how it's
  // delivered.
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

// The one index the SSE polling loop's query actually needs: "give me
// every event on this channel with _id greater than the client's last
// seen id, in order." `_id` is already indexed by MongoDB by default and
// is monotonically increasing per-insert, which is what makes it usable
// directly as a resumable cursor matching the SSE `Last-Event-ID` header
// — no separate sequence counter needed.
eventSchema.index({ channel: 1, _id: 1 });

export default mongoose.models.Event || mongoose.model("Event", eventSchema);
