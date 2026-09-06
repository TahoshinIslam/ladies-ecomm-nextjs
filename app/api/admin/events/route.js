import { requireStaff } from "../../../../lib/auth.js";
import { withRoute } from "../../../../lib/http.js";
import { ADMIN_CHANNEL, readEventsSince, resolveStartCursor } from "../../../../lib/events.js";

// Route Handlers can be statically evaluated/buffered by default; an SSE
// stream needs to run fresh per-request and never get cached or closed
// early.
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
// `id: <id>` (Phase 11) makes the browser's native EventSource track
// `lastEventId` and automatically resend it as the `Last-Event-ID` request
// header on its own automatic reconnect — no custom reconnect logic
// needed client-side; see resolveStartCursor() in lib/events.js for how
// the server honors it.
const sseLine = (event, data, id) => {
  const idLine = id ? `id: ${id}\n` : "";
  return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_MS = 25000;
// Closes the stream itself, well before any configured Vercel function
// duration, forcing a clean client-initiated reconnect (EventSource
// retries automatically) rather than being cut off mid-frame by the
// platform. See docs/PRODUCTION_READINESS.md's function-duration
// inventory for the reasoning behind this specific bound.
const STREAM_MAX_MS = 4 * 60 * 1000;

// Broadcast stream for the whole admin team — new orders, low-stock alerts,
// product create/update, anything NotificationsDropdown previously only
// learned about on its next 30s poll. Any admin/employee can subscribe;
// this isn't gated by a specific permission (see requireStaff) since it's
// general team awareness, not a protected admin action.
//
// Phase 2: authenticates via the same-origin session cookie, same as every
// other route — EventSource sends cookies automatically for same-origin
// requests. The 401/403 checks below run BEFORE the stream opens, so an
// unauthorized request never gets a live connection at all.
//
// Phase 11 (mandatory): reads from the MongoDB-backed durable event outbox
// (lib/events.js) via bounded polling instead of a process-local
// EventEmitter — see that file's own comment for why an in-memory bus
// cannot work across Vercel's multiple isolated function instances.
export const GET = withRoute(async (request) => {
  await requireStaff(request);

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

      // Declared (not yet assigned) BEFORE `cleanup`/the abort listener:
      // resolveStartCursor() below is an `await`, so the request's abort
      // signal can fire while this function is still suspended there —
      // if `cleanup` closed over `const heartbeatTimer`/`pollTimer`
      // declared further down, referencing them from an abort that fires
      // during that await would throw (temporal dead zone), the timers
      // would then still get created moments later once the await
      // resolves, and — since `closed` was already set true by the time
      // that throw happened — never get cleared again: a leaked interval
      // that keeps the stream (and, in a test, the whole process) alive
      // forever. `let` here, assigned after, closes that gap.
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
        afterId = await resolveStartCursor(ADMIN_CHANNEL, request.headers.get("last-event-id"));
      } catch {
        afterId = null;
      }

      // The abort could have fired while the await above was pending —
      // don't start timers for a connection that's already closed.
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
          const events = await readEventsSince(ADMIN_CHANNEL, afterId);
          for (const ev of events) {
            afterId = ev._id;
            safeEnqueue(sseLine(ev.type, ev.payload, ev._id.toString()));
          }
        } catch (err) {
          // A transient DB read hiccup must not tear down the whole
          // stream — the next poll tick tries again. Never leaks any
          // internal detail to the client (nothing is sent here at all).
          console.error("admin SSE poll failed", err);
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
