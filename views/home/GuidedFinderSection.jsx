"use client";

// Phase 7 — the guided-finder card is almost entirely static copy; the
// ONE thing it needs is a Redux dispatch to open the finder modal, which
// requires a client boundary. Kept as its own small island rather than
// pulling the rest of the (static) home page along with it.
import { useDispatch } from "react-redux";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

import Button from "../../components/ui/Button.jsx";
import { setFinderOpen } from "../../store/uiSlice.js";
import { useLocale } from "../../context/LocaleProvider.jsx";
import FramedImage from "../../components/ui/FramedImage.jsx";
import { resolveImage } from "../../lib/utils.js";

// `image` is an admin-set URL (Shop Config → Guided Discovery) — plain,
// already-resolved data from the Server Component parent, not a fetch.
// Unset (the default) keeps the existing hatch-pattern placeholder.
export default function GuidedFinderSection({ image, framing = null }) {
  const { t } = useLocale();
  const dispatch = useDispatch();

  return (
    <section aria-labelledby="finder-h" className="container-x pt-32">
      <div
        data-reveal
        className="relative grid overflow-hidden rounded-[26px] border border-line bg-surface lg:grid-cols-[1.1fr_1fr]"
      >
        <div className="p-8 sm:p-14">
          <div className="eyebrow">{t("home.guidedDiscoveryEyebrow")}</div>
          <h2
            id="finder-h"
            className="mt-4 text-[clamp(32px,3.2vw,46px)] font-semibold leading-[1.02] tracking-[-0.03em]"
          >
            {t("home.notSureTitle")}
          </h2>
          <p className="mt-3.5 max-w-[36ch] text-xl leading-[1.5] text-stone">
            {t("home.notSureBody")}
          </p>
          <Button
            variant="primary"
            size="xl"
            className="mt-7"
            onClick={() => dispatch(setFinderOpen(true))}
          >
            {t("home.helpMeChoose")}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div className="mt-[22px] font-mono text-[11px] uppercase tracking-[0.1em] text-stone">
            {t("home.threeQuestions")}
          </div>
        </div>
        {/* Was `hidden ... lg:grid` (image-and-tags panel invisible below
            lg) — now shown at every breakpoint. Border moves from the
            side (dividing the two columns at lg:) to the top (dividing
            the stacked panels below lg:), since its job is separating
            this panel from the text above/beside it either way. */}
        <div className="relative grid min-h-[340px] place-items-center overflow-hidden border-t border-line bg-media lg:border-l lg:border-t-0">
          {image && framing ? (
            // Saved crop (Admin → Shop Config → Guided Discovery → Adjust framing).
            <FramedImage src={image} framing={framing} placement="guided.panel" sizes="(max-width: 1024px) 100vw, 50vw" />
          ) : image ? (
            // object-top: this box's height is fixed independent of
            // whatever aspect ratio gets uploaded (Shop Config → Guided
            // Discovery photo) — same reasoning as the department/fabric/
            // occasion cards in views/HomePage.jsx, so any necessary crop
            // comes off the bottom, never a subject's face at the top.
            <Image src={resolveImage(image, 700)} alt="" fill sizes="50vw" className="object-cover object-top" />
          ) : (
            <div aria-hidden="true" className="absolute inset-0 hatch" />
          )}
          <div className="relative flex gap-3.5">
            <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
              {t("home.everyday")}
            </span>
            <span className="rounded-lg bg-verm-contrast px-4 py-2.5 text-[14.5px] font-medium text-white">
              {t("home.fullCoverage")}
            </span>
            <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
              {t("home.eid")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
