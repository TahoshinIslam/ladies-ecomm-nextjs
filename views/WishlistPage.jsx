"use client";

import { Heart, Home } from "lucide-react";

import ProductCard from "../components/product/ProductCard.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Button from "../components/ui/Button.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";
import { useGetWishlistQuery } from "../store/shopApi.js";
import { useLocale } from "../context/LocaleProvider.jsx";
import Link from "next/link";

export default function WishlistPage() {
  const { t } = useLocale();
  const { data, isLoading } = useGetWishlistQuery();
  const products = data?.wishlist?.products || [];

  return (
    <div className="container-x py-10">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.saved"), icon: Heart },
        ]}
      />
      <h1 className="font-heading text-3xl font-black">{t("wishlist.yourWishlist")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("wishlist.itemsSaved", { count: products.length })}
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
            title={t("wishlist.empty")}
            message={t("wishlist.saveItemsMessage")}
            action={
              <Link href="/shop">
                <Button>{t("cart.continueShopping")}</Button>
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
