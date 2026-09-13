import Notification from "../models/notificationModel.js";
import User from "../models/userModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";
import { emitUserEvent, emitBestEffort } from "../lib/events.js";

// Fans a notification out to every admin/employee — called internally from
// orderService.js (new order) and reviewService.js (new review). Already a
// live dependency of both before this file existed (they imported it
// straight from controllers/notificationController.js); moving it here is
// the reason those two files' imports get updated alongside this one.
export async function createAdminNotification({ message, url }) {
  const admins = await User.find({ role: { $in: ["admin", "employee"] } }).select("_id");
  if (!admins.length) return;

  const docs = admins.map((u) => ({ recipient: u._id, message, url }));
  await Notification.insertMany(docs);
}

// The customer-facing counterpart to createAdminNotification above — one
// recipient (an order's owner), not a team broadcast. Called from
// orderService.js's updateOrderStatus() on every genuine status
// transition (shipped/delivered/cancelled/...), which is also what makes
// GET /api/notifications (already keyed by requireUser(), never
// admin-only — see that route) return something for a signed-in
// customer, not just staff. Also emits on that customer's own event
// channel (lib/events.js's userChannel) so an already-open tab's bell
// updates immediately via useUserEventStream, the same realtime path
// createAdminNotification's callers get via emitAdminEvent — awaited with
// emitBestEffort so a failure here is logged, never thrown, and never
// turns an otherwise-successful order-status update into a failed
// request.
export async function createUserNotification({ recipient, message, url }) {
  const notification = await Notification.create({ recipient, message, url });
  await emitBestEffort(emitUserEvent(recipient, { type: "NEW_NOTIFICATION", message, url }));
  return notification;
}

export async function getNotifications(userId, { page = 1, limit = 20, unreadOnly } = {}) {
  const skip = (Number(page) - 1) * Number(limit);
  const filter = { recipient: userId };
  if (unreadOnly === "true" || unreadOnly === true) filter.readAt = null;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort("-createdAt").skip(skip).limit(Number(limit)),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: userId, readAt: null }),
  ]);

  return { total, unreadCount, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, notifications };
}

export async function markAsRead(userId, notificationId) {
  requireObjectIdFormat(notificationId, "notificationId");
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { readAt: new Date() },
    { new: true },
  );
  if (!notification) throw new HttpError(404, "Notification not found");
  return notification;
}

export async function markAllAsRead(userId) {
  await Notification.updateMany({ recipient: userId, readAt: null }, { readAt: new Date() });
}
