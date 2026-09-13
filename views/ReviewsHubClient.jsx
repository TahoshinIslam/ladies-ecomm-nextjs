"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Star, MessageSquarePlus } from "lucide-react";

import Button from "../components/ui/Button.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import ReviewForm from "../components/review/ReviewForm.jsx";
import { ReviewItem } from "../components/review/ReviewList.jsx";
import { useGetMyReviewProductsQuery } from "../store/shopApi.js";
import { useLocale } from "../context/LocaleProvider.jsx";
import { resolveImage } from "../lib/utils.js";

/**
 * The account "Reviews" page's actual content — one place to see every
 * product from a delivered order that's still waiting on a review, and
 * every review already left, instead of the previous only path (open a
 * specific delivered order on /orders, one at a time, to find its
 * "Write a review" button). GET /reviews/mine (services/reviewService.js's
 * getMyReviewProducts) does the real eligibility check server-side —
 * this only renders whatever it returns.
 */
export default function ReviewsHubClient() {
  const { t } = useLocale();
  const { data, isLoading, isError, refetch } = useGetMyReviewProductsQuery();
  const [openProductId, setOpenProductId] = useState(null);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("account.reviewsLoadError")}</p>
        <Button onClick={refetch} className="mt-4" size="sm">
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const reviewable = data?.reviewable ?? [];
  const reviewed = data?.reviewed ?? [];

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-lg font-bold">{t("account.reviewsToReview")}</h2>
        {reviewable.length === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            title={t("account.reviewsNoneToReview")}
            message={t("account.reviewsNoneToReviewBody")}
          />
        ) : (
          <ul className="space-y-3">
            {reviewable.map((p) => {
              const open = openProductId === p._id;
              return (
                <li key={p._id} className="rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="relative h-14 w-14 flex-none overflow-hidden rounded-md bg-muted">
                      {p.images?.[0] && (
                        <Image
                          src={resolveImage(p.images[0], 120)}
                          alt=""
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <Link href={`/product/${p.slug}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {p.name}
                    </Link>
                    <Button
                      type="button"
                      size="sm"
                      variant={open ? "outline" : "primary"}
                      onClick={() => setOpenProductId(open ? null : p._id)}
                    >
                      {open ? t("common.cancel") : t("product.writeReview")}
                    </Button>
                  </div>
                  {open && (
                    <div className="mt-3">
                      <ReviewForm
                        productId={p._id}
                        productName={p.name}
                        onSuccess={() => setOpenProductId(null)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("account.reviewsYours")}</h2>
        {reviewed.length === 0 ? (
          <EmptyState
            icon={Star}
            title={t("account.reviewsNoneYet")}
            message={t("account.reviewsNoneYetBody")}
          />
        ) : (
          <ul className="space-y-4">
            {reviewed.map((r) => (
              <li key={r._id}>
                {r.product && (
                  <Link
                    href={`/product/${r.product.slug}`}
                    className="mb-1.5 inline-block text-sm font-semibold text-foreground hover:underline"
                  >
                    {r.product.name}
                  </Link>
                )}
                <ReviewItem review={r} isOwn />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
