"use client";

// Phase 7 — the guided-finder card is almost entirely static copy; the
// ONE thing it needs is a Redux dispatch to open the finder modal, which
// requires a client boundary. Kept as its own small island rather than
// pulling the rest of the (static) home page along with it.
import { useDispatch } from "react-redux";
import { ArrowRight } from "lucide-react";

import Button from "../../components/ui/Button.jsx";
import { setFinderOpen } from "../../store/uiSlice.js";
import { useLocale } from "../../context/LocaleProvider.jsx";

export default function GuidedFinderSection() {
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
        <div className="relative hidden min-h-[340px] border-l border-line bg-media lg:grid lg:place-items-center">
          <div aria-hidden="true" className="absolute inset-0 hatch" />
          <div className="relative flex gap-3.5">
            <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
              {t("home.everyday")}
            </span>
            <span className="rounded-lg bg-verm px-4 py-2.5 text-[14.5px] font-medium text-white">
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
