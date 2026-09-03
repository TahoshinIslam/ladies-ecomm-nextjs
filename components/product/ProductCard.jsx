"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { BellRing, Heart, ImageOff, Scale } from "lucide-react";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "sonner";

import {
  useToggleWishlistMutation,
  useGetWishlistQuery,
} from "../../store/shopApi.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { addToCompare, removeFromCompare, openQuickAdd } from "../../store/uiSlice.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { cn, resolveImage } from "../../lib/utils.js";

/**
 * The board's card is a 4:5 media plate on the surface colour with the product
 * floating on it — no card border, no shadow. Depth comes from the hatch, the
 * contact shadow under the shoe, and a 1.6° tilt on hover; the quick-add bar
 * rises into the plate rather than covering the whole image.
 */
export default function ProductCard({ product, className, index = 0, onQuickAdd }) {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const settings = useSettings();
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const [toggleWishlist, { isLoading: wlLoading }] = useToggleWishlistMutation();
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });
  const compareList = useSelector((s) => s.ui.compareList);

  const isCompared = compareList.includes(product._id);
  const compareFull = !isCompared && compareList.length >= 4;
  const isWished = !!wlData?.wishlist?.products?.some(
    (p) => (p._id || p) === product._id,
  );

  // Unavailable when every variant/size is out of stock. `variants` is the
  // modest-fashion schema; `sizes` is the legacy mock-catalog shape — check
  // both so this works against either data source.
  const isUnavailable = product.variants?.length
    ? product.variants.every((v) => (v.stock ?? 0) <= 0)
    : product.sizes?.length
    ? product.sizes.every((s) => (s.stock ?? 0) <= 0)
    : product.stock === 0;

  const price = product.discountPrice ?? product.basePrice;
  const discounted =
    product.discountPrice && product.discountPrice < product.basePrice;

  const categoryName = product.category?.name;
  const fabric = product.attributes?.find((a) => a.key === "fabric")?.values.join(", ");
  const colorCount = product.attributes?.find((a) => a.key === "color")?.values.length;
  const availabilityLabel =
    product.availability === "preOrder" ? "Pre-order" : product.availability === "madeToOrder" ? "Made to order" : null;

  const handleWishlist = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error("Please sign in to save this pair");
      return;
    }
    try {
      const res = await toggleWishlist(product._id).unwrap();
      toast.success(res.added ? "Saved" : "Removed from saved");
    } catch {
      toast.error("Could not update your saved pairs");
    }
  };

  const handleCompare = (e) => {
    e.preventDefault();
    if (isCompared) {
      dispatch(removeFromCompare(product._id));
      return;
    }
    if (compareFull) {
      toast.error("You can compare up to 4 pairs");
      return;
    }
    dispatch(addToCompare(product._id));
  };

  // A single QuickAddSheet instance lives in the storefront layout (same
  // pattern as CartDrawer/SearchModal); the card just tells it which product
  // to open for. `onQuickAdd` stays available as an override for callers that
  // want different behavior (e.g. the compare tray).
  const handleQuickAdd = (e) => {
    e.preventDefault();
    if (onQuickAdd) onQuickAdd(product);
    else dispatch(openQuickAdd(product));
  };

  const handleNotify = (e) => {
    e.preventDefault();
    toast.success("We'll email you if this colorway restocks");
  };

  const href = `/product/${product.slug || product._id}`;

  return (
    <motion.article
      id={`product-${product._id}`}
      data-reveal
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px -12%" }}
      transition={{ duration: 0.5, delay: Math.min(index, 7) * 0.06, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn("group relative flex flex-col", className)}
    >
      <Link href={href} className="focus-ring rounded-[14px]">
        <div className="relative aspect-4/5 overflow-hidden rounded-[14px] bg-media">
          <div aria-hidden="true" className="absolute inset-0 hatch" />
          <div aria-hidden="true" className="absolute inset-0 glow" />

          <div
            className="absolute inset-x-[10%] bottom-[16%] top-[12%] grid place-items-center transition-transform duration-[220ms]"
            style={{
              transform:
                hovered && !isUnavailable ? "rotate(-1.6deg) scale(1.04)" : "none",
              opacity: isUnavailable ? 0.45 : 1,
            }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-[6%] -bottom-[6%] h-[18%] contact-shadow"
            />
            {product.images?.[0] && !imageFailed ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={resolveImage(product.images[0], 640)}
                alt={product.name}
                width="640"
                height="800"
                decoding="async"
                // Above-the-fold cards load eagerly so they don't cost LCP.
                loading={index < 6 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                className="relative h-full w-full object-contain"
                onError={() => setImageFailed(true)}
              />
            ) : imageFailed ? (
              <span className="relative flex flex-col items-center gap-2 px-4 text-center text-stone">
                <ImageOff className="h-5 w-5" strokeWidth={1.6} />
                <span className="font-mono text-[10.5px] uppercase leading-[1.7] tracking-[0.08em]">
                  Image didn&rsquo;t load
                  <br />
                  {product.name}
                </span>
              </span>
            ) : (
              <span className="relative px-4 text-center font-mono text-[10.5px] uppercase leading-[1.7] tracking-[0.08em] text-stone">
                {product.name}
              </span>
            )}
          </div>

          {isUnavailable ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-ink/85 px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-canvas">
              Sold out
            </span>
          ) : availabilityLabel ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-ink/85 px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-canvas">
              {availabilityLabel}
            </span>
          ) : discounted ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-verm px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-white">
              −
              {Math.round(
                ((product.basePrice - product.discountPrice) / product.basePrice) * 100,
              )}
              %
            </span>
          ) : null}

          {/* Save / compare */}
          <div className="absolute right-2.5 top-2.5 flex flex-col gap-2">
            <button
              onClick={handleWishlist}
              disabled={wlLoading}
              aria-label={isWished ? `Remove ${product.name} from saved` : `Save ${product.name}`}
              aria-pressed={isWished}
              className={cn(
                "grid h-[38px] w-[38px] place-items-center rounded-lg border border-line bg-elev transition-colors hover:border-ink focus-ring active:scale-95",
                isWished ? "text-verm" : "text-ink",
              )}
            >
              <Heart
                className="h-[17px] w-[17px]"
                strokeWidth={1.7}
                fill={isWished ? "currentColor" : "none"}
              />
            </button>
            <button
              onClick={handleCompare}
              aria-label={isCompared ? `Remove ${product.name} from compare` : `Compare ${product.name}`}
              aria-pressed={isCompared}
              className={cn(
                "grid h-[38px] w-[38px] place-items-center rounded-lg border border-line bg-elev opacity-0 transition-[opacity,color,border-color] hover:border-ink focus-ring focus-visible:opacity-100 group-hover:opacity-100",
                isCompared && "border-ink text-verm opacity-100",
                compareFull && "opacity-40",
              )}
            >
              <Scale className="h-[17px] w-[17px]" strokeWidth={1.7} />
            </button>
          </div>

          {/* Quick add / restock notice */}
          {isUnavailable ? (
            <div className="absolute inset-x-2.5 bottom-2.5">
              <button
                onClick={handleNotify}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-line bg-elev text-sm font-semibold text-ink transition-colors hover:border-ink focus-ring active:scale-[0.985]"
              >
                <BellRing className="h-4 w-4" strokeWidth={1.8} />
                Notify me if it returns
              </button>
            </div>
          ) : (
            <div
              className="absolute inset-x-2.5 bottom-2.5 transition-[opacity,transform] duration-200"
              style={{
                opacity: hovered ? 1 : 0,
                transform: hovered ? "none" : "translateY(8px)",
              }}
            >
              <button
                onClick={handleQuickAdd}
                tabIndex={hovered ? 0 : -1}
                className="h-11 w-full rounded-lg bg-ink text-sm font-semibold text-canvas transition-colors hover:bg-verm hover:text-white focus-ring active:scale-[0.985]"
              >
                Quick add
              </button>
            </div>
          )}
        </div>

        <div className="mt-3.5 flex items-start justify-between gap-3.5">
          <div className="min-w-0">
            {categoryName && (
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone">
                {categoryName}
              </div>
            )}
            <h3 className="mt-1.5 text-[17.5px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
              {product.name}
            </h3>
            <div className="mt-1.5 text-[13.5px] text-stone">
              {[fabric, colorCount > 1 && `${colorCount} colors`, product.brand?.name]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="flex flex-none flex-col items-end">
            <span data-tabular className="text-[16.5px] font-semibold text-ink">
              {settings.formatPrice(price)}
            </span>
            {discounted && (
              <span
                data-tabular
                className="text-[13px] text-stone line-through"
              >
                {settings.formatPrice(product.basePrice)}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
