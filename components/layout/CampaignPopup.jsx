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

import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { resolveImage } from "../../lib/utils.js";
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

  return (
    <Modal open={open} onClose={close} size="sm" title={title || undefined}>
      <div className="p-5">
        {image &&
          (promotion.clickable ? (
            <Link href={promotion.href} onClick={close} className="relative mb-4 block aspect-[4/3] w-full overflow-hidden rounded-lg focus-ring">
              <Image src={resolveImage(image, 600)} alt={alt} fill sizes="(max-width: 640px) 90vw, 400px" className="object-cover" />
            </Link>
          ) : (
            <div className="relative mb-4 aspect-[4/3] w-full overflow-hidden rounded-lg">
              <Image src={resolveImage(image, 600)} alt={alt} fill sizes="(max-width: 640px) 90vw, 400px" className="object-cover" />
            </div>
          ))}
        {subtitle && <p className="mb-4 text-sm text-stone">{subtitle}</p>}
        {promotion.clickable && (
          <Link href={promotion.href} onClick={close}>
            <Button variant="accent" className="w-full">
              {ctaLabel}
            </Button>
          </Link>
        )}
      </div>
    </Modal>
  );
}
