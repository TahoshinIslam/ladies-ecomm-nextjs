import { getSessionUserFromQuery } from "../../../../../lib/auth.js";
import { HttpError, withRoute } from "../../../../../lib/http.js";
import { eventBus, orderChannel } from "../../../../../lib/events.js";
import Order from "../../../../../models/orderModel.js";

// Route Handlers can be statically evaluated/buffered by default; an SSE
// stream needs to run fresh per-request and never get cached or closed
// early.
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const sseLine = (event, data) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// Server-sent events for one order's status — the customer's order-success
// and order-detail pages subscribe here so a status change made in admin
// reaches them immediately instead of waiting for a manual refresh.
// EventSource can't send the Authorization header, so auth travels as
// ?token= (see getSessionUserFromQuery) — everything else in this app stays
// header-only.
export const GET = withRoute(async (request, { params }) => {
  const user = await getSessionUserFromQuery(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");

  const { id } = await params;
  const order = await Order.findById(id).select("user").lean();
  if (!order) throw new HttpError(404, "Order not found");
  const isOwner = order.user.toString() === String(user._id);
  if (!isOwner && user.role !== "admin") throw new HttpError(403, "Not authorized");

  const channel = orderChannel(id);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseLine("connected", { orderId: id }));

      const onUpdate = (payload) => {
        controller.enqueue(sseLine("ORDER_STATUS_UPDATED", payload));
      };
      eventBus.on(channel, onUpdate);

      // Comment ping every 25s so intermediary proxies/load balancers don't
      // time out and silently close an otherwise-idle connection.
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25000);

      request.signal.addEventListener("abort", () => {
        eventBus.off(channel, onUpdate);
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
