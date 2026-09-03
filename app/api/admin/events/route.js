import { getSessionUserFromQuery } from "../../../../lib/auth.js";
import { HttpError, withRoute } from "../../../../lib/http.js";
import { eventBus, ADMIN_CHANNEL } from "../../../../lib/events.js";

// Route Handlers can be statically evaluated/buffered by default; an SSE
// stream needs to run fresh per-request and never get cached or closed
// early.
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const sseLine = (event, data) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// Broadcast stream for the whole admin team — new orders, low-stock alerts,
// product create/update, anything NotificationsDropdown previously only
// learned about on its next 30s poll. Any admin/employee can subscribe;
// this isn't gated by a specific permission (see requireStaff) since it's
// general team awareness, not a protected admin action.
export const GET = withRoute(async (request) => {
  const user = await getSessionUserFromQuery(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
  if (!["admin", "employee"].includes(user.role)) throw new HttpError(403, "Staff access only");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseLine("connected", {}));

      const onEvent = (payload) => {
        controller.enqueue(sseLine(payload.type, payload));
      };
      eventBus.on(ADMIN_CHANNEL, onEvent);

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25000);

      request.signal.addEventListener("abort", () => {
        eventBus.off(ADMIN_CHANNEL, onEvent);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
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
