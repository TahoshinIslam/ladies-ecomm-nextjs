import { EventEmitter } from "events";

// A single in-process event bus for server-sent-events. Fine for one server
// instance (dev, or a single deployed process) — a client connected to one
// process only ever hears events emitted in that same process. Scaling to
// multiple instances/regions later needs a shared broker (Redis pub/sub is
// the usual next step) fanning events into each instance's bus; nothing
// here assumes single-instance forever, but nothing pretends it's already
// multi-instance-safe either.
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(0); // unbounded SSE subscribers

export const orderChannel = (orderId) => `order:${orderId}`;
export const ADMIN_CHANNEL = "admin";

export function emitOrderEvent(orderId, payload) {
  eventBus.emit(orderChannel(orderId), payload);
}

export function emitAdminEvent(payload) {
  eventBus.emit(ADMIN_CHANNEL, payload);
}
