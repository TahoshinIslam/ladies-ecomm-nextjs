"use client";

// The small banners beside the hero carousel, stacked so their combined height is exactly the carousel's. A slot is either a picture the
// owner uploaded (Settings → Shop layout → Offer banners — the words are part of the picture) or, when none is set, a real product card
// (photo, name, % off, price; discounted products first), so a banner is never blank and a price here is the price on the product page.
// Below lg the same banners sit in a sideways-scrolling row under the carousel.
import Image from "next/image";
import Link from "next/link";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { effectivePrice, isRealDiscount, isPlaceholderStub, resolveImage } from "../../lib/utils.js";

export default function MiniBanners({ slots }) {
  const { t } = useLocale();
  const settings = useSettings();
  if (!slots?.length) return null;

  return (
    <ul
      aria-label={t("home.miniBannersLabel")}
      className="-mx-2.5 flex snap-x snap-mandatory scroll-px-2.5 gap-3 overflow-x-auto px-2.5 pb-1 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:flex lg:h-full lg:w-[300px] lg:flex-none lg:flex-col xl:w-[340px]"
    >
      {slots.map((slot) => {
        if (slot.kind === "image") {
          return (
            <li key={slot.key} className="aspect-[2.3/1] w-[82%] max-w-[340px] flex-none snap-start sm:w-auto sm:max-w-none lg:aspect-auto lg:min-h-0 lg:flex-1">
              <Link href={slot.href} className="group relative block h-full w-full overflow-hidden rounded-[22px] border border-line bg-media focus-ring">
                <Image
                  src={resolveImage(slot.imageUrl, 800)}
                  alt={`${t("home.miniBannersLabel")} ${slot.index + 1}`}
                  fill
                  sizes="(max-width: 1024px) 82vw, 340px"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </Link>
            </li>
          );
        }
        const { product } = slot;
        const discounted = isRealDiscount(product);
        const image = product.images?.[0];
        const percent = discounted ? Math.round(((product.basePrice - product.discountPrice) / product.basePrice) * 100) : 0;
        return (
          <li key={product._id} className="min-h-[104px] w-[82%] max-w-[320px] flex-none snap-start sm:w-auto sm:max-w-none lg:min-h-0 lg:flex-1">
            <Link
              href={`/product/${product.slug || product._id}`}
              className="group flex h-full items-center gap-3 rounded-[22px] border border-line bg-surface p-3 transition-shadow sm:p-4 hover:shadow-md focus-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[14px] font-semibold uppercase leading-snug tracking-[0.01em] text-ink">{product.name}</span>
                {discounted ? <span className="mt-1.5 inline-block rounded-md bg-danger px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none text-white">{t("product.discountBadge", { percent })}</span> : null}
                <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span data-tabular className="text-[16px] font-bold text-verm">{settings.formatPrice(effectivePrice(product), product.priceCurrency)}</span>
                  {discounted ? <span data-tabular className="text-[12px] text-stone line-through">{settings.formatPrice(product.basePrice, product.priceCurrency)}</span> : null}
                </span>
              </span>
              <span className="relative h-[84px] w-[84px] flex-none overflow-hidden rounded-lg bg-media lg:h-[92px] lg:w-[92px]">
                {image && !isPlaceholderStub(image) ? (
                  <Image src={resolveImage(image, 240)} alt="" fill sizes="96px" className="object-contain transition-transform duration-300 group-hover:scale-[1.05]" />
                ) : (
                  <span aria-hidden="true" className="absolute inset-0 hatch" />
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
