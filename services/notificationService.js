import Notification from "../models/notificationModel.js";
import User from "../models/userModel.js";
import { HttpError } from "../lib/http.js";

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
