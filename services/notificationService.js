import Notification from "../models/notificationModel.js";
import User from "../models/userModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";
import { emitUserEvent, emitBestEffort } from "../lib/events.js";

// Fans a notification out to every admin/employee — called internally from
// orderService.js (new order) and reviewService.js (new review).
export async function createAdminNotification({ message, url }) {
  const staffIds = await User.findStaffIds();
  if (!staffIds.length) return;
  // "staff": these ids are dashboard accounts in `users`, not shoppers in
  // `customers`, and the notification row has to record which.
  await Notification.insertMany(staffIds.map((id) => ({ recipient: id, message, url })), "staff");
}

// The customer-facing counterpart to createAdminNotification above — one
// recipient (an order's owner), not a team broadcast.
export async function createUserNotification({ recipient, message, url }) {
  const notification = await Notification.create({ recipient, message, url });
  await emitBestEffort(emitUserEvent(recipient, { type: "NEW_NOTIFICATION", message, url }));
  return notification;
}

export async function getNotifications(userId, { page = 1, limit = 20, unreadOnly } = {}) {
  const skip = (Number(page) - 1) * Number(limit);
  const unread = unreadOnly === "true" || unreadOnly === true;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.findByRecipient(userId, { unreadOnly: unread, skip, limit: Number(limit) }),
    Notification.countByRecipient(userId, { unreadOnly: unread }),
    Notification.countByRecipient(userId, { unreadOnly: true }),
  ]);

  return { total, unreadCount, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, notifications };
}

export async function markAsRead(userId, notificationId) {
  requireObjectIdFormat(notificationId, "notificationId");
  const notification = await Notification.markRead(notificationId, userId);
  if (!notification) throw new HttpError(404, "Notification not found");
  return notification;
}

export async function markAllAsRead(userId) {
  await Notification.markAllRead(userId);
}
