"use client";

import { useState } from "react";
import Image from "next/image";
import { useSelector } from "react-redux";
import { ThumbsUp, BadgeCheck, Pencil, Trash2, X, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import Rating from "../ui/Rating.jsx";
import Button from "../ui/Button.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import Textarea from "../ui/Textarea.jsx";

import {
  useGetProductReviewsQuery,
  useMarkHelpfulMutation,
  useUpdateReviewMutation,
  useDeleteReviewMutation,
} from "../../store/shopApi.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { formatDhakaDate } from "../../lib/date.js";
import { isApprovedImageSource } from "../../lib/approvedImageSource.js";

const REVIEWS_PER_PAGE = 10;

// `rating`/`numReviews` are the product's own denormalized fields (see
// models/reviewModel.js's calcAverageRating, updated on every real review
// save/delete) — passed down from the product already fetched by the PDP,
// rather than re-derived here, so the big headline number always matches
// what the rest of the page (JSON-LD, the product card elsewhere) shows.
export default function ReviewList({ productId, rating, numReviews }) {
  const user = useSelector(selectCurrentUser);
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isError } = useGetProductReviewsQuery({
    productId,
    page,
    limit: REVIEWS_PER_PAGE,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">{t("reviews.loadError")}</p>
    );
  }

  const reviews = data?.reviews ?? [];
  const total = data?.total ?? numReviews ?? 0;
  const pages = data?.pages ?? 1;

  if (!total) {
    return (
      <EmptyState
        title={t("reviews.emptyTitle")}
        message={t("reviews.emptyMessage")}
      />
    );
  }

  return (
    <div className="grid gap-10 pt-8 lg:grid-cols-[260px_1fr]">
      <RatingSummary rating={rating} total={total} breakdown={data?.breakdown} />

      <div className="min-w-0">
        <ul className="space-y-4">
          {reviews.map((r) => (
            <ReviewItem
              key={r._id}
              review={r}
              isOwn={user && (r.user?._id === user._id || r.user === user._id)}
            />
          ))}
        </ul>

        {pages > 1 && (
          <ReviewPagination page={page} pages={pages} onChange={setPage} disabled={isFetching} />
        )}
      </div>
    </div>
  );
}

// Big headline average + a 5→1 star bar breakdown (percentage of `total`,
// same real counts services/reviewService.js's getProductReviews()
// aggregates server-side across every review, not just this page).
function RatingSummary({ rating, total, breakdown }) {
  const { t } = useLocale();
  return (
    <div className="border-b border-border pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8">
      <div data-tabular className="font-heading text-5xl font-bold leading-none">
        {(Number(rating) || 0).toFixed(1)}
      </div>
      <Rating value={rating} size={16} className="mt-2" />
      <p className="mt-2 text-sm text-muted-foreground">
        {t("product.reviewsCount", { count: total }).replace(/[()]/g, "")}
      </p>

      <div className="mt-5 space-y-1.5">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = breakdown?.[star] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={star} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-11 flex-none">{t("reviews.starLabel", { count: star })}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <span data-tabular className="w-9 flex-none text-right">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewPagination({ page, pages, onChange, disabled }) {
  const { t } = useLocale();
  return (
    <nav
      aria-label={t("pagination.page", { current: page, total: pages })}
      className="mt-6 flex items-center justify-between border-t border-border pt-4"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={disabled || page <= 1}
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-opacity disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" /> {t("pagination.previous")}
      </button>
      <span data-tabular className="text-xs text-muted-foreground">
        {t("pagination.page", { current: page, total: pages })}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={disabled || page >= pages}
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-opacity disabled:pointer-events-none disabled:opacity-40"
      >
        {t("pagination.next")} <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

// Exported so the account "Reviews" page (views/account/ReviewsHubPage.jsx)
// can reuse the exact same card — stars/title/comment/byline plus the
// owner's edit/delete controls — for "reviews you've already left"
// instead of re-implementing that UI a second time.
export function ReviewItem({ review, isOwn }) {
  const { t, locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.rating);
  const [comment, setComment] = useState(review.comment);
  const [title, setTitle] = useState(review.title || "");
  const [markHelpful, { isLoading: marking }] = useMarkHelpfulMutation();
  const [updateReview, { isLoading: saving }] = useUpdateReviewMutation();
  const [deleteReview, { isLoading: deleting }] = useDeleteReviewMutation();

  const handleHelpful = async () => {
    try {
      await markHelpful(review._id).unwrap();
    } catch (e) {
      toast.error(e?.data?.message || t("reviews.signInToMarkHelpful"));
    }
  };

  const handleSave = async () => {
    if (!comment.trim()) {
      toast.error(t("reviews.commentRequired"));
      return;
    }
    try {
      await updateReview({
        id: review._id,
        rating,
        title: title.trim() || undefined,
        comment: comment.trim(),
      }).unwrap();
      toast.warning(t("reviews.updated"));
      setEditing(false);
    } catch (e) {
      toast.error(e?.data?.message || t("reviews.updateFailed"));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t("reviews.deleteConfirm"))) return;
    try {
      await deleteReview(review._id).unwrap();
      toast.success(t("reviews.deleted"));
    } catch (e) {
      toast.error(e?.data?.message || t("reviews.deleteFailed"));
    }
  };

  return (
    <li className="rounded-lg border border-border bg-background p-5">
      {!editing ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Rating value={review.rating} size={14} />
            {review.isVerifiedPurchase && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                <BadgeCheck className="h-3 w-3" />
                {t("reviews.verified")}
              </span>
            )}
          </div>
          {review.title && (
            <p className="mt-3 font-heading text-base font-semibold">{review.title}</p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
            {review.comment}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full bg-muted text-[11px] font-bold">
              {review.user?.avatar && isApprovedImageSource(review.user.avatar) ? (
                <Image
                  src={review.user.avatar}
                  alt=""
                  fill
                  sizes="28px"
                  className="object-cover"
                />
              ) : (
                // Same reasoning as views/admin/UsersPage.jsx — a reviewer's
                // `avatar` is an arbitrary, unrestricted-origin URL that
                // proxy.js's production CSP already blocks the browser from
                // loading directly unless it's res.cloudinary.com/placehold.co;
                // the initials fallback is what an unapproved-origin avatar
                // actually renders as today.
                review.user?.name?.[0]?.toUpperCase() || "?"
              )}
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {review.user?.name || t("reviews.customerFallback")}
              {review.isVerifiedPurchase && <> — {t("reviews.verified")}</>}
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="text-yellow-400"
                aria-label={`${n} stars`}
              >
                <span className={n <= rating ? "" : "opacity-30"}>★</span>
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("reviews.titlePlaceholder")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
          />
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} loading={saving}>
              <Check className="h-4 w-4" /> {t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
            >
              <X className="h-4 w-4" /> {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Admin reply */}
      {review.adminReply?.text && !editing && (
        <div className="mt-3 rounded-md border-l-4 border-accent bg-accent/5 p-3">
          <p className="text-xs font-semibold text-accent">
            {t("reviews.replyFromStore")}
            {review.adminReply.repliedBy?.name &&
              ` · ${review.adminReply.repliedBy.name}`}
          </p>
          <p className="mt-1 text-sm whitespace-pre-line">
            {review.adminReply.text}
          </p>
        </div>
      )}

      {/* Footer actions */}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">{formatDhakaDate(review.createdAt, locale)}</span>
          <button
            onClick={handleHelpful}
            disabled={marking}
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            {t("reviews.helpful")}{" "}
            {review.helpfulCount > 0 && `(${review.helpfulCount})`}
          </button>
          {isOwn && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" /> {t("common.edit")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("common.remove")}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
