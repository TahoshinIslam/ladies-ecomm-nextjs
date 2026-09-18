import Review from "../models/reviewModel.js";
import Order from "../models/orderModel.js";
import Product from "../models/productModel.js";
import { createAdminNotification } from "./notificationService.js";
import { HttpError } from "../lib/http.js";
import { emitAdminEvent, emitBestEffort } from "../lib/events.js";
import { requireObjectIdFormat } from "../lib/validation.js";

export async function getProductReviews(productId, { page = 1, limit = 10 } = {}) {
  const skip = (Number(page) - 1) * Number(limit);
  const [reviews, total, breakdown] = await Promise.all([
    Review.findByProduct(productId, { skip, limit: Number(limit) }),
    Review.countByProduct(productId),
    Review.ratingBreakdown(productId),
  ]);
  return {
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)) || 1,
    count: reviews.length,
    reviews,
    breakdown,
  };
}

// Backs the customer account "Reviews" page (account sidebar) — one place
// to see every product a shopper CAN review (something from a delivered
// order they haven't rated yet) alongside every review they've ALREADY
// left, instead of hunting through individual delivered orders on /orders
// one at a time to find a "Write a review" opportunity.
export async function getMyReviewProducts(userId) {
  const productIds = await Order.findDeliveredProductIdsByUser(userId);
  if (!productIds.length) return { reviewable: [], reviewed: [] };

  const [products, myReviews] = await Promise.all([
    Product.findByIds(productIds),
    Review.findByUserAndProducts(userId, productIds),
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const reviewByProduct = new Map(myReviews.map((r) => [String(r.product), r]));

  const reviewable = [];
  const reviewed = [];
  for (const id of productIds) {
    const key = String(id);
    const product = productById.get(key);
    // A product deactivated/deleted since delivery still shows in "already
    // reviewed" (the review itself references it, real history — never
    // silently dropped), but never as a NEW reviewable opportunity for
    // something that no longer has a real product doc to review.
    const review = reviewByProduct.get(key);
    if (review) {
      reviewed.push({ ...review, product: product || null });
    } else if (product) {
      reviewable.push(product);
    }
  }
  return { reviewable, reviewed };
}

export async function createReview(userId, productId, { rating, title, comment, images = [] }) {
  requireObjectIdFormat(productId, "productId");
  // Hard block: must have a delivered order containing this product.
  const hasDelivered = await Order.existsDeliveredWithProduct(userId, productId);
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
    // Unique index on (user, product) throws ER_DUP_ENTRY on duplicate.
    if (err.code === 11000) throw new HttpError(400, "You've already reviewed this product");
    throw err;
  }

  createAdminNotification({
    message: `New ${review.rating}★ review received`,
    url: "/admin/reviews",
  }).catch(() => {});
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
  return { productId };
}

export async function markHelpful(reviewId) {
  requireObjectIdFormat(reviewId, "reviewId");
  const review = await Review.incrementHelpful(reviewId);
  if (!review) throw new HttpError(404, "Review not found");
  return review.helpfulCount;
}

// ========== ADMIN ==========

export async function listAllReviews({ page = 1, limit = 20, rating, productId, search, sortBy, sortOrder } = {}) {
  const skip = (Number(page) - 1) * Number(limit);
  const { reviews, total } = await Review.findAdminList({ rating, productId, search, sortBy, sortOrder, skip, limit: Number(limit) });
  return { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, count: reviews.length, reviews };
}

export async function replyToReview(reviewId, adminUserId, text) {
  requireObjectIdFormat(reviewId, "reviewId");
  const review = await Review.findById(reviewId);
  if (!review) throw new HttpError(404, "Review not found");

  const trimmed = String(text || "").trim();
  review.adminReply = trimmed ? { text: trimmed, repliedBy: adminUserId, repliedAt: new Date() } : { text: "", repliedBy: null, repliedAt: null };

  await review.save();
  return Review.findById(reviewId);
}
