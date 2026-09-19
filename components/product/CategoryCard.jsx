import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";

import FramedImage from "../ui/FramedImage.jsx";
import { cn, resolveImage } from "../../lib/utils.js";

// Shared category tile — the ONE presentation both the homepage's "Shop
// your everyday favourites" row (as={"link"}, real navigation) and the
// Shop page's category-filter tile row (as={"button"}, a real onClick
// filter callback) render, so the two can never visually drift apart.
// Owns only presentation (image, label, sizing, hover/focus, active
// visuals, the missing-image fallback) — never routing or filter state;
// see each caller for that. No "use client" here deliberately: this
// component has no hooks/state of its own, so it renders identically
// whether imported from a Server Component (views/HomePage.jsx) or a
// Client Component (views/shop/ShopPageClient.jsx).
const TILE_CLASSES =
  "group flex w-[104px] flex-none flex-col items-center gap-2.5 text-center focus-ring sm:w-auto";
const IMAGE_CLASSES =
  "object-cover object-top transition-transform duration-300 group-hover:scale-[1.04]";
const LABEL_CLASSES = "text-[13px] font-medium leading-tight text-ink";

function CategoryTileVisual({ image, framing, icon: Icon, label, active, sizes }) {
  return (
    <>
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-2xl bg-media",
          // Accessible active state: an accent RING (not a color-only
          // background swap) plus a non-color checkmark badge below — two
          // redundant cues so "selected" never depends on color alone.
          active && "ring-2 ring-verm ring-offset-2 ring-offset-canvas",
        )}
      >
        {image && framing ? (
          // Saved crop (Admin → Shop Config → Departments → Adjust framing);
          // unframed images keep the object-cover object-top render below.
          <FramedImage
            src={image}
            framing={framing}
            placement="department.tile"
            sizes={sizes}
            className="transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : image ? (
          <Image src={resolveImage(image, 300)} alt="" fill sizes={sizes} className={IMAGE_CLASSES} />
        ) : Icon ? (
          <div aria-hidden="true" className="absolute inset-0 grid place-items-center">
            <Icon className="h-7 w-7 text-stone" strokeWidth={1.6} />
          </div>
        ) : (
          <div aria-hidden="true" className="absolute inset-0 hatch" />
        )}
        {active && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-verm-contrast text-white shadow-soft"
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <span className={cn(LABEL_CLASSES, active && "font-semibold text-verm")}>{label}</span>
    </>
  );
}

export default function CategoryCard({
  as = "link",
  href,
  onClick,
  label,
  image,
  framing = null,
  icon,
  active = false,
  disabled = false,
  sizes = "(max-width: 640px) 104px, 12vw",
}) {
  if (as === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active}
        className={cn(TILE_CLASSES, "disabled:cursor-not-allowed disabled:opacity-60")}
      >
        <CategoryTileVisual image={image} framing={framing} icon={icon} label={label} active={active} sizes={sizes} />
      </button>
    );
  }

  return (
    <Link href={href} className={TILE_CLASSES}>
      <CategoryTileVisual image={image} framing={framing} icon={icon} label={label} active={active} sizes={sizes} />
    </Link>
  );
}
