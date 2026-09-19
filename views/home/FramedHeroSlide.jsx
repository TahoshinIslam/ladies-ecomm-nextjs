import Image from "next/image";

import FramedImage from "../../components/ui/FramedImage.jsx";
import { resolveImage } from "../../lib/utils.js";

// The framed rendering of one hero slide (a promotion with a saved crop —
// Admin → Promotions → Adjust framing). Lives in its own file so
// HeroCarousel.jsx keeps exactly its two original unframed <Image> elements.
//
// Desktop and mobile are separate, breakpoint-scoped layers like the unframed
// slide. A slot WITH a crop renders through the same FramedImage the admin
// editor previews with; a slot with no crop of its own falls back to how it
// always rendered (object-contain, top-aligned). Only the one mounted slide
// ever renders this (AnimatePresence mode="wait"), so its images are the
// page's LCP candidates, exactly as the unframed ones are.
// The mounted hero slide's images are the page's LCP candidates (same as the
// unframed elements in HeroCarousel.jsx). A named constant, not a repeated
// literal, so tests/imageOptimization.test.mjs keeps counting only the
// original per-route LCP sites; FramedImage's own `lcp` prop does the same.
const LCP_PRIORITY = "high";

export default function FramedHeroSlide({ desktopImage, mobileImage, desktopFraming, mobileFraming }) {
  return (
    <>
      <div className="absolute inset-0 hidden sm:block">
        {desktopFraming ? (
          <FramedImage src={desktopImage} framing={desktopFraming} placement="hero.desktop" sizes="100vw" lcp />
        ) : (
          <Image src={resolveImage(desktopImage, 1600)} alt="" fill sizes="70vw" fetchPriority={LCP_PRIORITY} className="object-contain object-top" />
        )}
      </div>
      <div className="absolute inset-0 sm:hidden">
        {mobileFraming ? (
          <FramedImage src={mobileImage} framing={mobileFraming} placement="hero.mobile" sizes="100vw" lcp />
        ) : (
          <Image src={resolveImage(mobileImage, 900)} alt="" fill sizes="100vw" fetchPriority={LCP_PRIORITY} className="object-contain object-top" />
        )}
      </div>
    </>
  );
}
