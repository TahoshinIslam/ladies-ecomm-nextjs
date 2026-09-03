"use client";

import { Heart } from "lucide-react";

import ProductCard from "../components/product/ProductCard.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Button from "../components/ui/Button.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import { useGetWishlistQuery } from "../store/shopApi.js";
import Link from "next/link";

export default function WishlistPage() {
  const { data, isLoading } = useGetWishlistQuery();
  const products = data?.wishlist?.products || [];

  return (
    <div className="container-x py-10">
      <h1 className="font-heading text-3xl font-black">Your wishlist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {products.length} {products.length === 1 ? "item" : "items"} saved
      </p>

      <div className="mt-8">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Your wishlist is empty"
            message="Save items you love to come back later."
            action={
              <Link href="/shop">
                <Button>Browse shoes</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p, i) => (
              <ProductCard key={p._id} product={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
