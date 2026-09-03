"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Textarea from "../../components/ui/Textarea.jsx";

import { useCreateReviewMutation } from "../../store/shopApi.js";

export default function ReviewForm({ productId, productName }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState({});

  const [createReview, { isLoading }] = useCreateReviewMutation();

  const validate = () => {
    const next = {};
    if (rating < 1) next.rating = "Please select a star rating";
    if (!comment.trim()) next.comment = "Review comment is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await createReview({
        productId,
        rating,
        title: title.trim() || undefined,
        comment: comment.trim(),
      }).unwrap();

      toast.success("Review submitted");
      setRating(0);
      setTitle("");
      setComment("");
      setErrors({});
    } catch (err) {
      toast.error(err?.data?.message || "Could not submit review");
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-sm font-semibold text-foreground">
        Review {productName ? `"${productName}"` : "this product"}
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">Rating</label>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = displayRating >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHoverRating(n)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => {
                  setRating(n);
                  setErrors((prev) => ({ ...prev, rating: undefined }));
                }}
                className="rounded p-0.5 transition-transform hover:scale-110"
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                <Star
                  size={20}
                  className={filled ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/50"}
                  strokeWidth={1.5}
                />
              </button>
            );
          })}
          <span className="ml-2 text-xs text-muted-foreground">
            {rating > 0 ? `${rating}/5` : "Select a rating"}
          </span>
        </div>
        {errors.rating && <p className="mt-1 text-xs text-danger">{errors.rating}</p>}
      </div>

      <Input
        label="Title (optional)"
        placeholder="Summarize your experience"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <Textarea
        label="Comment"
        placeholder="What did you like or dislike?"
        rows={3}
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          if (errors.comment) setErrors((prev) => ({ ...prev, comment: undefined }));
        }}
        error={errors.comment}
      />

      <div className="flex justify-end">
        <Button type="submit" loading={isLoading} size="sm">
          Submit review
        </Button>
      </div>
    </form>
  );
}

