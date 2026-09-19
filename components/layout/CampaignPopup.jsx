"use client";

// Visitor campaign popup — dynamically imported (see StorefrontShell.jsx,
// same pattern as CartDrawer/SearchModal/etc.) so its code is never part of
// the critical initial storefront bundle. Renders nothing until a real
// eligible campaign is fetched AND this browser's own frequency state
// (lib/promotionFrequency.js) says it hasn't already been shown.
//
// Mounted only inside StorefrontShell.jsx, which itself sits outside
// /admin's own shell entirely — so "never on admin pages" is already
// structurally guaranteed and doesn't need a check here. The sensitive
// storefront routes below (checkout, auth, order confirmation) DO render
// inside the storefront shell, so those are excluded explicitly.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";

import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import FramedImage from "../ui/FramedImage.jsx";
import { resolveImage } from "../../lib/utils.js";
import { resolveSlotFraming, sanitizeFraming } from "../../lib/imageFraming.js";
import { shouldShowPopup, recordPopupShown, recordPopupDismissed } from "../../lib/promotionFrequency.js";

const EXCLUDED_PREFIXES = [
  "/checkout",
  "/cart",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/order-success",
  "/orders",
  "/profile",
  "/dashboard",
];

function pageScopeFor(pathname) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/shop")) return "shop";
  if (pathname.startsWith("/product/")) return "product";
  return null; // not one of this campaign system's eligible surfaces
}

export default function CampaignPopup() {
  const pathname = usePathname();
  const { locale } = useLocale();
  const [promotion, setPromotion] = useState(null);
  const [open, setOpen] = useState(false);

  const excluded = EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p));
  const pageScope = pageScopeFor(pathname);
  const eligibleRoute = !excluded && !!pageScope;

  // Fetches at most once per (pathname, pageScope) pair — see the
  // dependency array. RTK Query's own tag-based dedup isn't used here
  // deliberately: this is a plain, standalone dynamic-import island (kept
  // fully independent of the Redux Provider's own mount timing), and one
  // fetch per real page-scope change is already the correct, non-
  // duplicated request count this feature's own test suite checks for.
  //
  // Deliberately does NOT reset `promotion`/`open` synchronously when
  // `eligibleRoute` is false — the render guard below (`!eligibleRoute`)
  // already hides the popup on an excluded route without needing a
  // setState call in the effect's synchronous body.
  useEffect(() => {
    if (!eligibleRoute) return undefined;

    let cancelled = false;
    let showTimer = null;

    fetch(`/api/promotions/popup?pageScope=${pageScope}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.promotion) return;
        const p = json.promotion;
        if (!shouldShowPopup(p)) return;
        const delay = Math.min(10000, Math.max(500, p.popupDelayMs || 2000));
        showTimer = setTimeout(() => {
          if (cancelled) return;
          setPromotion(p);
          setOpen(true);
          recordPopupShown(p);
        }, delay);
      })
      .catch(() => {
        // A failed popup fetch must never block navigation or break the
        // page — silently give up for this page view.
      });

    return () => {
      cancelled = true;
      if (showTimer) clearTimeout(showTimer);
    };
  }, [pathname, pageScope, eligibleRoute]);

  const close = () => {
    setOpen(false);
    if (promotion) recordPopupDismissed(promotion);
  };

  if (!eligibleRoute || !open || !promotion) return null;

  const title = (locale === "bn" ? promotion.titleBn : promotion.title) || "";
  const subtitle = (locale === "bn" ? promotion.subtitleBn : promotion.subtitle) || "";
  const ctaLabel = (locale === "bn" ? promotion.ctaLabelBn : promotion.ctaLabel) || (locale === "bn" ? "এখনই কিনুন" : "Shop now");
  const alt = (locale === "bn" ? promotion.imageAltBn : promotion.imageAlt) || title;
  const image = promotion.mobileImage || promotion.desktopImage;

  // Saved crops (Admin → Promotions → Adjust framing). Same rules as the hero:
  // desktop uses its own crop, mobile its own or the desktop one carried over
  // when both show the same image; no crop at all = the untouched legacy
  // render (one <Image>, object-cover, mobile-preferred file).
  const desktopFraming = sanitizeFraming(promotion.desktopFraming);
  const mobileSrc = promotion.mobileImage || promotion.desktopImage;
  const mobileFraming = resolveSlotFraming({ own: promotion.mobileFraming, ownSrc: mobileSrc, other: desktopFraming, otherSrc: promotion.desktopImage });
  const isFramed = Boolean(desktopFraming || mobileFraming);
  const imageContent = isFramed ? (
    <>
      <div className="absolute inset-0 hidden sm:block">
        {desktopFraming ? (
          <FramedImage src={promotion.desktopImage} framing={desktopFraming} placement="popup.desktop" sizes="896px" priority />
        ) : (
          <Image src={resolveImage(image, 1200)} alt={alt} fill sizes="896px" className="object-cover" priority />
        )}
      </div>
      <div className="absolute inset-0 sm:hidden">
        {mobileFraming ? (
          <FramedImage src={mobileSrc} framing={mobileFraming} placement="popup.mobile" sizes="100vw" priority />
        ) : (
          <Image src={resolveImage(mobileSrc, 900)} alt={alt} fill sizes="100vw" className="object-cover" priority />
        )}
      </div>
    </>
  ) : (
    <Image src={resolveImage(image, 1200)} alt={alt} fill sizes="(max-width: 768px) 100vw, 900px" className="object-cover" priority />
  );

  // Large, edge-to-edge creative with a floating close control overlaid on
  // the image itself (no separate title header bar eating into it) — this
  // is deliberately a much bigger, image-first presentation than a typical
  // form/confirmation modal, matching how a real campaign popup needs to
  // read as an actual promotional banner, not a small dialog box.
  return (
    <Modal open={open} onClose={close} size="xl" hideHeader className="rounded-3xl">
      <div className="relative">
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-ink/60 text-white backdrop-blur-sm transition-colors hover:bg-ink/80 focus-ring"
        >
          <X className="h-5 w-5" />
        </button>
        {/* A width-based aspect ratio (the previous `aspect-[16/9] w-full`)
            made the image taller than the viewport on short/laptop screens
            — image height + the text block below then exceeded the panel's
            own `max-h-[90vh]`, forcing Modal's `overflow-y-auto` to show a
            scrollbar. A viewport-height-based, capped height instead keeps
            the image (and therefore the whole popup) reliably short enough
            to fit on one screen with no scrolling, at any panel width. */}
        {image &&
          (promotion.clickable ? (
            <Link href={promotion.href} onClick={close} className="relative block h-[32vh] max-h-[340px] min-h-[180px] w-full overflow-hidden focus-ring">
              {imageContent}
            </Link>
          ) : (
            <div className="relative h-[32vh] max-h-[340px] min-h-[180px] w-full overflow-hidden">
              {imageContent}
            </div>
          ))}
        {(title || subtitle || promotion.clickable) && (
          <div className="p-5 text-center sm:p-6">
            {title && <h3 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">{title}</h3>}
            {subtitle && <p className="mt-1.5 text-sm text-stone sm:text-base">{subtitle}</p>}
            {promotion.clickable && (
              <Link href={promotion.href} onClick={close} className="mt-4 block">
                <Button variant="accent" className="w-full sm:w-auto sm:px-10">
                  {ctaLabel}
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
