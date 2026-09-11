"use client";

import { useState } from "react";
import Image from "next/image";
import { useSelector } from "react-redux";
import { ThumbsUp, BadgeCheck, Pencil, Trash2, X, Check } from "lucide-react";
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

export default function ReviewList({ productId }) {
  const user = useSelector(selectCurrentUser);
  const { t } = useLocale();
  const { data, isLoading, isError } = useGetProductReviewsQuery({
    productId,
    page: 1,
    limit: 20,
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
  if (!reviews.length) {
    return (
      <EmptyState
        title={t("reviews.emptyTitle")}
        message={t("reviews.emptyMessage")}
      />
    );
  }

  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <ReviewItem
          key={r._id}
          review={r}
          isOwn={user && (r.user?._id === user._id || r.user === user._id)}
        />
      ))}
    </ul>
  );
}

function ReviewItem({ review, isOwn }) {
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
    <li className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
          {review.user?.avatar && isApprovedImageSource(review.user.avatar) ? (
            <Image
              src={review.user.avatar}
              alt={review.user.name}
              fill
              sizes="40px"
              className="rounded-full object-cover"
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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold">{review.user?.name || t("reviews.customerFallback")}</p>
            {review.isVerifiedPurchase && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                <BadgeCheck className="h-3 w-3" />
                {t("reviews.verified")}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDhakaDate(review.createdAt, locale)}
            </span>
          </div>

          {!editing ? (
            <>
              <div className="mt-1">
                <Rating value={review.rating} size={14} />
              </div>
              {review.title && (
                <p className="mt-2 text-sm font-semibold">{review.title}</p>
              )}
              <p className="mt-1 text-sm text-foreground/90 whitespace-pre-line">
                {review.comment}
              </p>
            </>
          ) : (
            <div className="mt-2 space-y-2">
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
        </div>
      </div>
    </li>
  );
}
