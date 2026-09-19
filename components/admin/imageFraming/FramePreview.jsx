import Image from "next/image";

import FramedImage from "../../ui/FramedImage.jsx";
import { cn, resolveImage } from "../../../lib/utils.js";
import { getPlacement, sanitizeFraming } from "../../../lib/imageFraming.js";

// A destination frame at its EXACT aspect ratio showing an image the way the
// storefront will: through FramedImage when a framing is saved (the same
// component the site renders), or with the placement's legacy CSS when the
// image was never framed (so previews of untouched images stay truthful too).
// `maxWidthPx` caps the frame's width; the aspect ratio never changes.
export default function FramePreview({ placement, url, framing, maxWidthPx = 360, className, sizes }) {
  const p = getPlacement(placement);
  const f = sanitizeFraming(framing);
  const [aw, ah] = p.aspect;
  const frameStyle = { aspectRatio: `${aw} / ${ah}`, width: `min(100%, ${maxWidthPx}px)` };
  const src = resolveImage(url, 900);

  if (!url) {
    return <div className={cn("grid place-items-center rounded-md bg-muted text-xs text-muted-foreground", className)} style={frameStyle}>No image</div>;
  }

  if (!f && p.legacy.natural) {
    // The unframed banner has no fixed frame: it takes the image's own shape.
    return (
      <div className={cn("overflow-hidden rounded-md bg-muted", className)} style={{ width: `min(100%, ${maxWidthPx}px)` }}>
        <Image src={src} alt="" width={1400} height={420} sizes={sizes || "360px"} className="h-auto w-full" />
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)} style={frameStyle}>
      {f ? (
        <FramedImage src={url} framing={f} placement={placement} sizes={sizes || "360px"} />
      ) : (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes || "360px"}
          className={p.legacy.fit === "contain" ? "object-contain" : "object-cover"}
          style={{ objectPosition: p.legacy.position }}
        />
      )}
    </div>
  );
}
