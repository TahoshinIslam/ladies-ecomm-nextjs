import Review from "../models/reviewModel.js";
import Order from "../models/orderModel.js";
import { createAdminNotification } from "./notificationService.js";
import { HttpError } from "../lib/http.js";
import { emitAdminEvent, emitBestEffort } from "../lib/events.js";
import { requireObjectIdFormat } from "../lib/validation.js";

export async function getProductReviews(productId, { page = 1, limit = 10 } = {}) {
  const skip = (Number(page) - 1) * Number(limit);
  const filter = { product: productId };
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate("user", "name avatar")
      .populate("adminReply.repliedBy", "name")
      .sort("-createdAt")
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Review.countDocuments(filter),
  ]);
  return { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, count: reviews.length, reviews };
}

export async function createReview(userId, productId, { rating, title, comment, images = [] }) {
  requireObjectIdFormat(productId, "productId");
  // Hard block: must have a delivered order containing this product.
  const hasDelivered = await Order.exists({
    user: userId,
    "items.product": productId,
    status: "delivered",
  });
  if (!hasDelivered) throw new HttpError(403, "You can only review products from delivered orders");

  let review;
  try {
    review = await Review.create({
      user: userId,
      product: productId,
      rating,
      title,
      comment,
      images,
      isVerifiedPurchase: true,
    });
  } catch (err) {
    // Unique index on {user, product} throws E11000 on duplicate.
    if (err.code === 11000) throw new HttpError(400, "You've already reviewed this product");
    throw err;
  }

  createAdminNotification({
    message: `New ${review.rating}★ review received`,
    url: "/admin/reviews",
  }).catch(() => {});
  // Non-transactional (a plain single-document create) — awaited so a
  // failure is observed/logged before returning, but never fails the
  // already-succeeded review submission. See lib/events.js's
  // emitBestEffort() for the documented policy.
  await emitBestEffort(emitAdminEvent({ type: "NEW_NOTIFICATION", message: `New ${review.rating}★ review received`, url: "/admin/reviews" }));

  return review;
}

export async function updateReview(reviewId, actingUser, { rating, title, comment, images }) {
  requireObjectIdFormat(reviewId, "reviewId");
  const review = await Review.findById(reviewId);
  if (!review) throw new HttpError(404, "Review not found");

  const isOwner = review.user.toString() === actingUser._id.toString();
  if (!isOwner && actingUser.role !== "admin") throw new HttpError(403, "Not authorized");

  if (rating !== undefined) review.rating = rating;
  if (title !== undefined) review.title = title;
  if (comment !== undefined) review.comment = comment;
  if (images !== undefined) review.images = images;
  await review.save();
  return review;
}

export async function deleteReview(reviewId, actingUser) {
  requireObjectIdFormat(reviewId, "reviewId");
  const review = await Review.findById(reviewId);
  if (!review) throw new HttpError(404, "Review not found");

  if (review.user.toString() !== actingUser._id.toString() && actingUser.role !== "admin") {
    throw new HttpError(403, "Not authorized");
  }
  const productId = review.product.toString();
  await review.deleteOne();
  // Callers that only cared about "did this succeed" (the pre-Phase-8
  // behavior) can keep ignoring this — it's new, additive information,
  // not a changed contract for anyone already awaiting this call.
  return { productId };
}

export async function markHelpful(reviewId) {
  requireObjectIdFormat(reviewId, "reviewId");
  const review = await Review.findByIdAndUpdate(reviewId, { $inc: { helpfulCount: 1 } }, { new: true });
  if (!review) throw new HttpError(404, "Review not found");
  return review.helpfulCount;
}

// ========== ADMIN ==========

const REVIEW_SORT_FIELDS = { createdAt: "createdAt", rating: "rating", helpfulCount: "helpfulCount" };

export async function listAllReviews({ page = 1, limit = 20, rating, productId, search, sortBy, sortOrder } = {}) {
  const skip = (Number(page) - 1) * Number(limit);
  const filter = {};
  if (rating) filter.rating = Number(rating);
  if (productId) filter.product = productId;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ comment: rx }, { title: rx }];
  }

  const sortField = REVIEW_SORT_FIELDS[sortBy] || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate("user", "name email avatar")
      .populate("product", "name images slug")
      .populate("adminReply.repliedBy", "name")
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments(filter),
  ]);

  return { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, count: reviews.length, reviews };
}

export async function replyToReview(reviewId, adminUserId, text) {
  requireObjectIdFormat(reviewId, "reviewId");
  const review = await Review.findById(reviewId);
  if (!review) throw new HttpError(404, "Review not found");

  const trimmed = String(text || "").trim();
  review.adminReply = trimmed
    ? { text: trimmed, repliedBy: adminUserId, repliedAt: new Date() }
    : { text: "", repliedBy: undefined, repliedAt: undefined };

  await review.save();
  await review.populate("user", "name avatar");
  await review.populate("adminReply.repliedBy", "name");
  return review;
}
