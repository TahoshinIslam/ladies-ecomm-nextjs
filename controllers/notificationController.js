import asyncHandler from "../middleware/asyncHandler.js";
import Notification from "../models/notificationModel.js";
import User from "../models/userModel.js";

/**
 * Helper to create a notification for all admin/employee users.
 * Called internally from orderController and reviewController.
 */
export const createAdminNotification = async ({ message, url }) => {
  const admins = await User.find({
    role: { $in: ["admin", "employee"] },
  }).select("_id");
  if (!admins.length) return;

  const docs = admins.map((u) => ({
    recipient: u._id,
    message,
    url,
  }));
  await Notification.insertMany(docs);
};

// @desc    Get paginated notifications for current user
// @route   GET /api/notifications
// @access  Private (admin/employee)
export const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const filter = { recipient: req.user._id };
  if (unreadOnly === "true") filter.readAt = null;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort("-createdAt")
      .skip(skip)
      .limit(Number(limit)),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user._id, readAt: null }),
  ]);

  res.json({
    success: true,
    total,
    unreadCount,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)) || 1,
    notifications,
  });
});

// @desc    Mark a notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { readAt: new Date() },
    { new: true },
  );
  if (!notification) {
    res.status(404);
    throw new Error("Notification not found");
  }
  res.json({ success: true, notification });
});

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private (admin/employee)
export const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { recipient: req.user._id, readAt: null },
    { readAt: new Date() },
  );
  res.json({ success: true, message: "All notifications marked as read" });
});
