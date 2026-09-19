import Image from "next/image";

import { framedImageStyle, sanitizeFraming, scaleSizes, widthFactor } from "../../lib/imageFraming.js";
import { resolveImage } from "../../lib/utils.js";

// Renders an image with a saved framing (lib/imageFraming.js) inside a frame
// the CALLER provides (`relative overflow-hidden` + whatever aspect/size rules
// that placement already has). No "use client" and no hooks on purpose: it
// must render identically from a Server Component (the storefront) and from
// the admin editor preview — that identity is what makes "preview == site".
//
// The wrapper is a `container-type: size` box filling the caller's frame; the
// image inside is positioned with container-query units (see
// framedImageStyle), so it always covers/fits the frame's ACTUAL shape.
//
// Returns null without a usable framing — callers keep their existing
// (legacy) markup for that case, so unframed images render exactly as before.
//
// `lcp` marks the page's one genuine largest-contentful image (high fetch
// priority). It is a prop — not a literal at the call site — so the repo's
// "high priority is scoped to genuine LCP images" source guard still counts
// only the legacy elements it was written for.
// A browser-local preview (blob:/data: URL of a file the admin just picked)
// works as-is: next/image itself skips the optimizer for those URLs.
export default function FramedImage({
  src,
  framing,
  placement,
  alt = "",
  sizes,
  priority = false,
  lcp = false,
  loading,
  fetchPriority,
  onError,
  className,
}) {
  const f = sanitizeFraming(framing);
  const style = framedImageStyle(f);
  if (!src || !f || !style) return null;
  return (
    <div className="absolute inset-0" style={{ containerType: "size" }}>
      <Image
        src={resolveImage(src, Math.min(f.w, 2560))}
        alt={alt}
        width={f.w}
        height={f.h}
        sizes={scaleSizes(sizes, widthFactor(f, placement))}
        priority={priority}
        loading={loading}
        fetchPriority={lcp ? "high" : fetchPriority}
        onError={onError}
        className={className}
        style={style}
        draggable={false}
      />
    </div>
  );
}
