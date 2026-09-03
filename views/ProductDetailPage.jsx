"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  ShoppingBag,
  Minus,
  Plus,
  Truck,
  RefreshCw,
  Shield,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import Rating from "../components/ui/Rating.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import ProductCard from "../components/product/ProductCard.jsx";
import ReviewList from "../components/review/ReviewList.jsx";

import {
  useGetProductQuery,
  useGetRelatedProductsQuery,
} from "../store/productApi.js";
import {
  useToggleWishlistMutation,
  useGetWishlistQuery,
} from "../store/shopApi.js";
import { selectCurrentUser } from "../store/authSlice.js";
import { setCartOpen } from "../store/uiSlice.js";
import { useCart } from "../hooks/useCart.js";
import { formatCurrency, cn, resolveImage } from "../lib/utils.js";
import { useSettings } from "../context/SettingsContext.jsx";

export default function ProductDetailPage() {
  const { idOrSlug } = useParams();
  const { data, isLoading } = useGetProductQuery(idOrSlug);
  const product = data?.product;
  const { freeShippingPitch } = useSettings();
  const freeShipAmount = freeShippingPitch();
  const { data: relatedData } = useGetRelatedProductsQuery(product?._id, {
    skip: !product?._id,
  });

  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const cart = useCart();
  const [adding, setAdding] = useState(false);
  const [toggleWishlist] = useToggleWishlistMutation();
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });

  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const [quantity, setQuantity] = useState(1);

  if (isLoading) {
    return (
      <div className="container-x py-10">
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container-x py-20 text-center">
        <h2 className="font-heading text-2xl font-bold">Product not found</h2>
        <Link href="/shop" className="mt-4 inline-block text-accent hover:underline">
          ← Back to shop
        </Link>
      </div>
    );
  }

  const hasArtwork = product.images?.length > 0;
  const images = hasArtwork ? product.images : [];
  const price = product.discountPrice ?? product.basePrice;
  const hasDiscount =
    product.discountPrice && product.discountPrice < product.basePrice;
  const isWished = !!wlData?.wishlist?.products?.some(
    (p) => (p._id || p) === product._id
  );
  // `variants` is the modest-fashion schema; `sizes` is the legacy
  // mock-catalog shape — normalize to one shape so the rest of this
  // component doesn't need to know which one it got.
  const sizeOptions = product.variants?.length
    ? product.variants.map((v) => ({ size: v.attributes?.size || v.variantName, stock: v.stock }))
    : product.sizes || [];
  const selectedSizeStock = sizeOptions.find((s) => s.size === selectedSize);
  const inStock = selectedSizeStock ? selectedSizeStock.stock > 0 : true;
  const maxQty = selectedSizeStock?.stock || 0;
  // Every size sold out — distinct from "no size picked yet", and from a
  // single out-of-stock size within an otherwise available product.
  const isProductUnavailable = sizeOptions.every((s) => (s.stock ?? 0) <= 0);

  const handleNotify = () => {
    toast.success("We'll email you if this colorway restocks");
  };

  const handleAdd = async () => {
    if (!selectedSize) {
      toast.error("Please select a size");
      return;
    }
    setAdding(true);
    try {
      await cart.addItem({ product, size: selectedSize, quantity });
      toast.success("Added to cart");
      dispatch(setCartOpen(true));
    } catch (e) {
      toast.error(e?.data?.message || "Could not add to cart");
    } finally {
      setAdding(false);
    }
  };

  const handleWishlist = async () => {
    if (!user) {
      toast.error("Please sign in");
      return;
    }
    try {
      const r = await toggleWishlist(product._id).unwrap();
      toast.success(r.added ? "Added to wishlist" : "Removed from wishlist");
    } catch {
      toast.error("Could not update wishlist");
    }
  };

  return (
    <div className="container-x py-10">
      {/* Breadcrumbs */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-foreground">Shop</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Gallery — capped and centered at 768-1023px only: the grid stays
            single-column until lg (1024), so without this the image (and
            its aspect-square) renders at the full column width and can run
            ~700px tall on a tablet, pushing price/size/CTA off the first
            screen. Reverts to filling its lg:grid-cols-2 column at 1024+. */}
        <div className="w-full space-y-4 md:mx-auto md:max-w-[440px] lg:mx-0 lg:max-w-none">
          <motion.div
            key={selectedImage}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="relative aspect-square overflow-hidden rounded-2xl bg-media"
          >
            {/* Hatched plate stands in until artwork exists, matching the way
                ProductCard renders a product with no images. */}
            <div aria-hidden="true" className="absolute inset-0 hatch" />
            <div aria-hidden="true" className="absolute inset-0 glow" />
            {hasArtwork ? (
              <img
                src={resolveImage(images[selectedImage], 800)}
                alt={product.name}
                width="800"
                height="800"
                fetchPriority="high"
                decoding="async"
                className="relative h-full w-full object-contain"
              />
            ) : (
              <span className="absolute inset-0 grid place-items-center px-8 text-center font-mono text-[11px] uppercase leading-[1.8] tracking-[0.08em] text-stone">
                {product.brand?.name} {product.name}
              </span>
            )}
          </motion.div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={cn(
                    "h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border-2 transition-colors",
                    i === selectedImage ? "border-accent" : "border-transparent"
                  )}
                >
                  <img src={resolveImage(src, 160)} alt="" width="80" height="80" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div>
              {product.brand?.name && (
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {product.brand.name}
                </p>
              )}
              <h1 className="mt-1 font-heading text-3xl font-black lg:text-4xl">
                {product.name}
              </h1>
            </div>
            {product.isFeatured && <Badge variant="accent">Featured</Badge>}
          </div>

          {/* No reviews have been collected yet — the rating row simply
              doesn't render rather than showing a fabricated 0-star score. */}
          {product.numReviews != null && (
            <div className="mt-3 flex items-center gap-3">
              <Rating value={product.rating} size={16} showValue />
              <span className="text-sm text-muted-foreground">
                ({product.numReviews} {product.numReviews === 1 ? "review" : "reviews"})
              </span>
            </div>
          )}

          <div className="mt-5 flex items-baseline gap-3">
            <span className="font-heading text-4xl font-black">
              {formatCurrency(price)}
            </span>
            {hasDiscount && (
              <>
                <span className="text-xl text-muted-foreground line-through">
                  {formatCurrency(product.basePrice)}
                </span>
                <Badge variant="danger">
                  -{Math.round(((product.basePrice - product.discountPrice) / product.basePrice) * 100)}%
                </Badge>
              </>
            )}
          </div>

          <p className="mt-5 text-foreground/80 text-pretty">
            {product.description}
          </p>

          {/* Metadata chips */}
          <div className="mt-5 flex flex-wrap gap-2">
            {product.model && <Badge variant="outline">Model: {product.model}</Badge>}
            {product.color && <Badge variant="outline">Color: {product.color}</Badge>}
            {product.material && <Badge variant="outline">Material: {product.material}</Badge>}
            {product.gender && <Badge variant="outline" className="capitalize">Gender: {product.gender}</Badge>}
            {product.ageGroup && <Badge variant="outline" className="capitalize">{product.ageGroup}</Badge>}
          </div>

          {isProductUnavailable ? (
            /* Every size is gone — the exact copy the design calls for, not
               a disabled "Out of stock" button standing in for it. */
            <div className="mt-6 rounded-2xl border border-line bg-media p-6">
              {product.colorway && (
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone">
                  {product.colorway}
                </p>
              )}
              <p className="mt-2 text-[15.5px] leading-relaxed text-ink">
                This colorway is gone. Restocks aren&rsquo;t guaranteed—we&rsquo;ll
                email you if it returns.
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={handleNotify}
                className="mt-4 w-full sm:w-auto"
              >
                Notify me if it returns
              </Button>
            </div>
          ) : (
            <>
              {/* Sizes */}
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-bold uppercase tracking-wider">Size</span>
                  <button className="text-xs text-muted-foreground hover:text-accent">
                    Size guide
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
                  {sizeOptions.map((s) => {
                    const disabled = s.stock === 0;
                    const active = selectedSize === s.size;
                    return (
                      <button
                        key={s.size}
                        disabled={disabled}
                        onClick={() => {
                          setSelectedSize(s.size);
                          setQuantity(1);
                        }}
                        className={cn(
                          "flex h-12 items-center justify-center rounded-md border text-sm font-semibold transition-all",
                          active && "border-accent bg-accent text-accent-foreground shadow-card",
                          !active && !disabled && "border-border hover:border-foreground",
                          disabled && "cursor-not-allowed border-border bg-muted/30 text-muted-foreground/50 line-through"
                        )}
                      >
                        {s.size}
                      </button>
                    );
                  })}
                </div>
                {selectedSize && selectedSizeStock && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selectedSizeStock.stock} in stock
                  </p>
                )}
              </div>

              {/* Quantity + actions */}
              <div className="mt-6 flex gap-3">
                <div className="flex items-center rounded-md border border-border">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    aria-label="Decrease"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center text-sm font-bold">{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => Math.min(maxQty || 99, q + 1))}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground"
                    aria-label="Increase"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <Button
                  size="lg"
                  onClick={handleAdd}
                  loading={adding}
                  disabled={!inStock}
                  className="flex-1"
                >
                  <ShoppingBag className="h-4 w-4" />
                  {inStock ? "Add to cart" : "Select a different size"}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleWishlist}
                  aria-label="Wishlist"
                >
                  <Heart className={cn("h-4 w-4", isWished && "fill-danger text-danger")} />
                </Button>
              </div>
            </>
          )}

          {/* Perks */}
          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-border pt-6">
            <Perk
              icon={Truck}
              title="Free shipping"
              desc={freeShipAmount ? `Over ${freeShipAmount}` : "On qualifying orders"}
            />
            <Perk icon={RefreshCw} title="30-day returns" desc="Easy & free" />
            <Perk icon={Shield} title="Secure checkout" desc="Stripe, bKash, Nagad" />
          </div>
        </div>
      </div>

      {/* Reviews */}
      <section className="mt-16">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="font-heading text-2xl font-bold">
              Customer reviews
            </h2>
            {product.numReviews != null && (
              <div className="mt-1 flex items-center gap-2">
                <Rating value={product.rating} size={14} showValue />
                <span className="text-sm text-muted-foreground">
                  {product.numReviews}{" "}
                  {product.numReviews === 1 ? "review" : "reviews"}
                </span>
              </div>
            )}
          </div>
        </div>
        <ReviewList productId={product._id} />
        <p className="mt-4 text-xs text-muted-foreground">
          Only customers with a delivered order for this product can post a
          review. Submit yours from your{" "}
          <Link href="/orders" className="text-accent hover:underline">
            order history
          </Link>
          .
        </p>
      </section>

      {/* Related */}
      {relatedData?.products?.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-6 font-heading text-2xl font-bold">You may also like</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {relatedData.products.slice(0, 4).map((p, i) => (
              <ProductCard key={p._id} product={p} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Perk({ icon: Icon, title, desc }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Icon className="mb-1 h-5 w-5 text-accent" />
      <p className="text-xs font-bold">{title}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}
