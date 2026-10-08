import { requireUser } from "../../../../lib/auth.js";
import { HttpError, withRoute } from "../../../../lib/http.js";
import { userChannel, readEventsSince, resolveStartCursor } from "../../../../lib/events.js";

// Route Handlers can be statically evaluated/buffered by default; an SSE
// stream needs to run fresh per-request and never get cached or closed
// early.
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
// `id: <id>` makes the browser's native EventSource track `lastEventId`
// and automatically resend it as the `Last-Event-ID` request header on
// its own automatic reconnect — no custom reconnect logic needed
// client-side; see resolveStartCursor() in lib/events.js for how the
// server honors it. Same shape as the staff event stream that used to sit
// at app/api/admin/events, before shop management moved to the dashboard.
const sseLine = (event, data, id) => {
  const idLine = id ? `id: ${id}\n` : "";
  return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_MS = 25000;
// Closes the stream itself, well before any configured Vercel function
// duration, forcing a clean client-initiated reconnect (EventSource
// retries automatically) rather than being cut off mid-frame by the
// platform — same bound as the admin stream.
const STREAM_MAX_MS = 4 * 60 * 1000;

// Per-customer notification stream — "order updates live, delivery
// status": an order status change reaches this customer's own open tab
// immediately instead of waiting for the notification bell's fallback
// poll. Scoped to this one signed-in user's own channel (lib/events.js's
// userChannel) — never a broadcast, unlike the admin stream — so one
// shopper's session can never see another's notifications.
export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const channel = userChannel(user._id.toString());

  let afterId;
  try {
    afterId = await resolveStartCursor(channel, request.headers.get("last-event-id"));
  } catch {
    throw new HttpError(503, "Realtime stream temporarily unavailable, please retry");
  }

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

      safeEnqueue(sseLine("connected", {}));

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
          // A transient DB read hiccup must not tear down the whole
          // stream — the next poll tick tries again. Never leaks any
          // internal detail to the client (nothing is sent here at all).
          console.error("user SSE poll failed", err);
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
