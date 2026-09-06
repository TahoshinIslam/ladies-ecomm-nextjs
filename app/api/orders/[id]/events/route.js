import { requireUser } from "../../../../../lib/auth.js";
import { HttpError, withRoute } from "../../../../../lib/http.js";
import { orderChannel, readEventsSince, resolveStartCursor } from "../../../../../lib/events.js";
import Order from "../../../../../models/orderModel.js";
import { requireObjectIdFormat } from "../../../../../lib/validation.js";

// Route Handlers can be statically evaluated/buffered by default; an SSE
// stream needs to run fresh per-request and never get cached or closed
// early.
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const sseLine = (event, data, id) => {
  const idLine = id ? `id: ${id}\n` : "";
  return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_MS = 25000;
const STREAM_MAX_MS = 4 * 60 * 1000;

// Server-sent events for one order's status — the customer's order-success
// and order-detail pages subscribe here so a status change made in admin
// reaches them immediately instead of waiting for a manual refresh.
//
// Phase 2: authenticates via the same-origin session cookie. Ownership is
// still checked below before the stream opens.
//
// Phase 11 (mandatory): reads from the MongoDB-backed durable event outbox
// (lib/events.js) via bounded polling instead of a process-local
// EventEmitter — see that file's own comment for why an in-memory bus
// cannot work across Vercel's multiple isolated function instances.
export const GET = withRoute(async (request, { params }) => {
  const user = await requireUser(request);

  const { id } = await params;
  requireObjectIdFormat(id, "id");
  const order = await Order.findById(id).select("user").lean();
  if (!order) throw new HttpError(404, "Order not found");
  const isOwner = order.user.toString() === String(user._id);
  if (!isOwner && user.role !== "admin") throw new HttpError(403, "Not authorized");

  const channel = orderChannel(id);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const startTime = Date.now();

      const safeEnqueue = (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          // stream already closed on the client side
        }
      };

      safeEnqueue(sseLine("connected", { orderId: id }));

      // See app/api/admin/events/route.js's identical comment: `let`,
      // declared before `cleanup`, avoids a temporal-dead-zone throw (and
      // a resulting leaked, never-cleared interval) if request.signal
      // aborts while the resolveStartCursor() await below is still
      // pending.
      let heartbeatTimer;
      let pollTimer;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        clearInterval(pollTimer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);

      let afterId;
      try {
        afterId = await resolveStartCursor(channel, request.headers.get("last-event-id"));
      } catch {
        afterId = null;
      }

      if (closed) return;

      heartbeatTimer = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_MS);

      pollTimer = setInterval(async () => {
        if (closed) return;
        if (Date.now() - startTime > STREAM_MAX_MS) {
          cleanup();
          return;
        }
        try {
          const events = await readEventsSince(channel, afterId);
          for (const ev of events) {
            afterId = ev._id;
            safeEnqueue(sseLine(ev.type, ev.payload, ev._id.toString()));
          }
        } catch (err) {
          console.error("order SSE poll failed", err);
        }
      }, POLL_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
