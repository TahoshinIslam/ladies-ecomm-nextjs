"use client";

import { useState } from "react";
import Image from "next/image";
import { Star, MessageSquare, Trash2, Send, X, Search, Pencil } from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Modal from "../../components/ui/Modal.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import AdminErrorState from "../../components/admin/AdminErrorState.jsx";
import Rating from "../../components/ui/Rating.jsx";
import Badge from "../../components/ui/Badge.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import TableToolbar from "../../components/admin/TableToolbar.jsx";

import {
  useListAllReviewsQuery,
  useReplyToReviewMutation,
  useDeleteReviewMutation,
  useUpdateReviewMutation,
} from "../../store/shopApi.js";
import { formatDateTime, resolveImage } from "../../lib/utils.js";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";

// Reviews stay a card list rather than a <table> — a comment/reply is
// long-form free text that needs to wrap and breathe, not sit constrained
// in a table cell — but gets the same URL-synced pagination, debounced
// search, and filter toolbar as every other admin list.
export default function AdminReviewsPage() {
  const { page, limit, search, filters, activeFilterCount, setPage, setLimit, setSearch, setFilter, clearFilters } =
    useTableQueryState({ defaultLimit: 20, filterKeys: ["rating"] });

  const [replying, setReplying] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const { data, isLoading, isFetching, isError, error, refetch } = useListAllReviewsQuery({
    page,
    limit,
    search: search || undefined,
    rating: filters.rating || undefined,
  });
  const reviews = data?.reviews ?? [];

  const [deleteReview, { isLoading: deleting }] = useDeleteReviewMutation();

  const handleDelete = async () => {
    try {
      await deleteReview(confirmDelete._id).unwrap();
      toast.success("Review deleted");
      if (reviews.length <= 1 && page > 1) setPage(page - 1);
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  const emptyState =
    search || activeFilterCount > 0 ? (
      <EmptyState icon={Search} title="No matching reviews" message="Try a different search or clear filters." />
    ) : (
      <EmptyState icon={MessageSquare} title="No reviews" message="Customer reviews will appear here once posted." />
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} reviews total</p>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search comment or title…"
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        filters={
          <Select
            value={filters.rating || ""}
            onChange={(e) => setFilter("rating", e.target.value)}
            className="max-w-[180px]"
            aria-label="Filter by rating"
          >
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>{r} stars</option>
            ))}
          </Select>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <AdminErrorState
          title="Couldn't load reviews"
          message={error?.data?.message || "Your session may have expired. Try again."}
          onRetry={refetch}
        />
      ) : reviews.length === 0 ? (
        emptyState
      ) : (
        <ul className={`space-y-3 ${isFetching ? "opacity-60" : ""}`}>
          {reviews.map((r) => (
            <li
              key={r._id}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Rating value={r.rating} size={14} showValue />
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </span>
                    {r.isVerifiedPurchase && (
                      <Badge variant="success">Verified</Badge>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    {r.product?.images?.[0] && (
                      <span className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded bg-muted">
                        <Image
                          src={resolveImage(r.product.images[0], 64)}
                          alt={r.product.name}
                          fill
                          sizes="32px"
                          loading="lazy"
                          className="object-contain"
                        />
                      </span>
                    )}
                    <p className="truncate text-sm font-semibold">
                      {r.product?.name || "Unknown product"}
                    </p>
                  </div>

                  {r.title && (
                    <p className="mt-2 text-sm font-semibold">{r.title}</p>
                  )}
                  <p className="mt-1 text-sm text-foreground/90 whitespace-pre-line">
                    {r.comment}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    by {r.user?.name || "—"} ({r.user?.email || "—"})
                  </p>

                  {r.adminReply?.text && (
                    <div className="mt-3 rounded-md border-l-4 border-accent bg-accent/5 p-3">
                      <p className="text-xs font-semibold text-accent">
                        Your reply
                        {r.adminReply.repliedBy?.name &&
                          ` · ${r.adminReply.repliedBy.name}`}
                        {r.adminReply.repliedAt &&
                          ` · ${formatDateTime(r.adminReply.repliedAt)}`}
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-line">
                        {r.adminReply.text}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReplying(r)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {r.adminReply?.text ? "Edit reply" : "Reply"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(r)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <button
                    onClick={() => setConfirmDelete(r)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    aria-label="Delete review"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && !isError && (data?.total > 0 || page > 1) && (
        <Pagination
          page={page}
          pages={data?.pages ?? 1}
          total={data?.total ?? 0}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      )}

      {replying && (
        <ReplyModal review={replying} onClose={() => setReplying(null)} />
      )}
      {editing && (
        <EditModal review={editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete this review?"
        description="This permanently removes the customer's review. The product rating will be recalculated."
        loading={deleting}
      />
    </div>
  );
}

function ReplyModal({ review, onClose }) {
  const [text, setText] = useState(review.adminReply?.text || "");
  const [reply, { isLoading }] = useReplyToReviewMutation();

  const save = async () => {
    try {
      await reply({ id: review._id, text }).unwrap();
      toast.success(text.trim() ? "Reply posted" : "Reply removed");
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save reply");
    }
  };

  return (
    <Modal open onClose={onClose} title="Reply to review" size="md">
      <div className="space-y-4 p-5">
        <div className="rounded-md bg-muted/30 p-3 text-sm">
          <Rating value={review.rating} size={12} />
          {review.title && <p className="mt-1 font-semibold">{review.title}</p>}
          <p className="mt-1 text-foreground/90 whitespace-pre-line">
            {review.comment}
          </p>
        </div>
        <Textarea
          label="Your reply"
          rows={4}
          placeholder="Thanks for the feedback…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty and save to remove an existing reply.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button onClick={save} loading={isLoading}>
            <Send className="h-4 w-4" /> Save reply
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ review, onClose }) {
  const [rating, setRating] = useState(review.rating);
  const [title, setTitle] = useState(review.title || "");
  const [comment, setComment] = useState(review.comment);
  const [update, { isLoading }] = useUpdateReviewMutation();

  const save = async () => {
    if (!comment.trim()) {
      toast.error("Comment is required");
      return;
    }
    try {
      await update({
        id: review._id,
        rating,
        title: title.trim() || undefined,
        comment: comment.trim(),
      }).unwrap();
      toast.warning("Review updated");
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update");
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit review (admin)" size="md">
      <div className="space-y-4 p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Rating</label>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="rounded p-1"
                aria-label={`${n} stars`}
              >
                <Star
                  size={20}
                  className={
                    n <= rating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/50"
                  }
                  strokeWidth={1.5}
                />
              </button>
            ))}
          </div>
        </div>
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Comment"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={isLoading}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
