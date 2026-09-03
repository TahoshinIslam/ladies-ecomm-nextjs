"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { setFinderOpen } from "../../store/uiSlice.js";
import { useGetProductsQuery } from "../../store/productApi.js";
import { useGetCategoriesQuery } from "../../store/shopApi.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrValue, departmentName } from "../../lib/i18n/catalog.js";
import { resolveImage } from "../../lib/utils.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Three questions built from this catalog's real facets, not invented copy
// (see the 2026-09 localization follow-up — this used to be leftover
// sneaker-shop content: "Retro runner" / "Court classic" answers mapped to
// "everyday"/"performance"/"statement" category hints that don't exist in
// this schema, so the quiz never actually matched real products).
//
// - Occasion answers are real `occasion` attribute values (see
//   attributeDefinitionModel.js's seed data) — the value itself (not its
//   translated label) becomes the `occasion` facet filter below, same
//   attribute-facet convention ShopPage's sidebar uses.
// - Garment answers are this store's six real departments, resolved to
//   their DB `_id` (the `category` filter needs the id, not the slug).
// - Budget thresholds are raw USD — Product.basePrice's own unit (see
//   services/productService.js's "stored in USD" note) — chosen so they
//   land on clean round Taka figures (~৳3,000/৳6,000) at the *default*
//   exchange rate; the button label always shows the *live* converted
//   amount via settings.toBdt(), never a hardcoded Taka figure that could
//   drift from the admin's current rate.
const OCCASION_VALUES = ["everyday", "prayer", "eid", "formal"];
const DEPARTMENT_SLUGS = ["burqa", "abaya", "hijab", "niqab", "khimar", "modest-sets"];
const BUDGET_ANSWERS = [
  { id: "under", basePrice: { lte: 25 } },
  { id: "mid", basePrice: { gte: 25, lte: 50 } },
  { id: "over", basePrice: { gte: 50 } },
  { id: "noLimit", basePrice: undefined },
];

/**
 * Three questions, no account needed. Mounted once in the storefront
 * layout, like the cart and search overlays, and opened from the hero's
 * "Help me choose" button (home.helpMeChoose).
 */
export default function ProductFinder() {
  const open = useSelector((s) => s.ui.finderOpen);
  const dispatch = useDispatch();
  const settings = useSettings();
  const { t, locale } = useLocale();
  const panelRef = useRef(null);
  const [step, setStep] = useState(0);
  // Stores each question's underlying *value* (occasion value / department
  // slug / budget id) — never the display label, so switching locale never
  // breaks an in-progress or completed quiz.
  const [answers, setAnswers] = useState([]);

  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? []).filter((c) => !c.parent);

  const budgetLabel = (b) => {
    if (!b.basePrice) return t("finder.budgetNoLimit");
    const { gte, lte } = b.basePrice;
    if (gte != null && lte != null) {
      return t("finder.budgetRange", { min: settings.formatBdt(settings.toBdt(gte)), max: settings.formatBdt(settings.toBdt(lte)) });
    }
    if (lte != null) return t("finder.budgetUnder", { amount: settings.formatBdt(settings.toBdt(lte)) });
    return t("finder.budgetOver", { amount: settings.formatBdt(settings.toBdt(gte)) });
  };

  const QUESTIONS = useMemo(
    () => [
      {
        questionKey: "finder.occasionQuestion",
        answers: OCCASION_VALUES.map((value) => ({ value, label: attrValue(locale, "occasion", value) })),
      },
      {
        questionKey: "finder.garmentQuestion",
        answers: DEPARTMENT_SLUGS.map((slug) => ({
          value: slug,
          label: departmentName(locale, slug, departments.find((d) => d.slug === slug)?.name),
        })),
      },
      {
        questionKey: "finder.budgetQuestion",
        answers: BUDGET_ANSWERS.map((b) => ({ value: b.id, label: budgetLabel(b) })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, departments, settings],
  );

  // Restart the quiz the moment the dialog closes, computed during render
  // rather than in an effect (React's "adjust state on prop change" shape).
  const [wasOpen, setWasOpen] = useState(open);
  if (!open && wasOpen) {
    setWasOpen(open);
    setStep(0);
    setAnswers([]);
  } else if (open && !wasOpen) {
    setWasOpen(open);
  }

  const done = answers.length === QUESTIONS.length;
  const [occasionAnswer, deptSlugAnswer, budgetAnswer] = answers;
  const deptId = departments.find((d) => d.slug === deptSlugAnswer)?._id;
  const budgetFilter = BUDGET_ANSWERS.find((b) => b.id === budgetAnswer)?.basePrice;

  const query = useMemo(
    () => ({
      ...(budgetFilter ? { basePrice: budgetFilter } : {}),
      category: deptId,
      occasion: occasionAnswer,
      limit: 3,
    }),
    [budgetFilter, deptId, occasionAnswer],
  );

  const { data, isFetching } = useGetProductsQuery(query, { skip: !done || !deptId });
  const picks = data?.products ?? [];

  const close = () => dispatch(setFinderOpen(false));

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (value) => {
    setAnswers((prev) => [...prev.slice(0, step), value]);
    setStep((s) => s + 1);
  };

  const restart = () => {
    setStep(0);
    setAnswers([]);
  };

  const progress = done ? 100 : (step / QUESTIONS.length) * 100;
  const current = QUESTIONS[step];
  const answerLabels = QUESTIONS.map((q, i) => q.answers.find((a) => a.value === answers[i])?.label).filter(Boolean);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[205] grid place-items-center p-6" onClick={close}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("home.helpMeChoose")}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[620px] rounded-[20px] border border-line bg-surface p-[34px] shadow-soft"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                {done ? t("finder.yourMatches") : t("finder.step", { current: step + 1, total: QUESTIONS.length })}
              </span>
              <button
                onClick={close}
                aria-label={t("finder.closeFinder")}
                className="grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            <div className="mt-3.5 h-[3px] overflow-hidden rounded-full bg-media">
              <div
                className="h-full rounded-full bg-verm transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            {done ? (
              <div>
                <h2 className="mt-7 text-[30px] font-semibold tracking-[-0.03em]">
                  {t("finder.matchesHeading", { count: isFetching ? "…" : picks.length })}
                </h2>
                <p className="mt-2.5 text-[15.5px] text-stone">
                  {t("finder.basedOn", { answers: answerLabels.join(", ") })}
                </p>
                <div className="mt-6 flex flex-col gap-2.5">
                  {isFetching
                    ? [0, 1, 2].map((i) => (
                        <div key={i} className="skeleton h-[88px] rounded-xl" />
                      ))
                    : picks.map((p) => (
                        <Link
                          key={p._id}
                          href={`/product/${p.slug || p._id}`}
                          onClick={close}
                          className="flex items-center gap-4 rounded-xl border border-line p-3.5 transition-colors hover:border-ink"
                        >
                          <span className="relative h-[60px] w-[60px] flex-none overflow-hidden rounded-[10px] bg-media">
                            {p.images?.[0] ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={resolveImage(p.images[0], 120)}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span aria-hidden="true" className="absolute inset-0 hatch" />
                            )}
                          </span>
                          <span className="flex-1">
                            <span className="block font-mono text-[10.5px] uppercase tracking-[0.12em] text-stone">
                              {departmentName(locale, p.category?.slug, p.category?.name)}
                            </span>
                            <span className="mt-1 block text-base font-semibold">
                              {p.name}
                            </span>
                          </span>
                          <span data-tabular className="text-[15.5px] font-semibold">
                            {settings.formatPrice(p.discountPrice ?? p.basePrice)}
                          </span>
                        </Link>
                      ))}
                  {!isFetching && picks.length === 0 && (
                    <p className="rounded-xl border border-line p-4 text-sm text-stone">
                      {t("finder.nothingMatched")}
                    </p>
                  )}
                </div>
                <div className="mt-6 flex gap-2.5">
                  <Link
                    href="/shop"
                    onClick={close}
                    className="flex h-[50px] flex-1 items-center justify-center rounded-[9px] bg-verm text-[15px] font-semibold text-white transition-colors hover:bg-ink hover:text-canvas"
                  >
                    {t("finder.seePairs")}
                  </Link>
                  <button
                    onClick={restart}
                    className="h-[50px] rounded-[9px] border border-line px-5 text-[14.5px] font-semibold transition-colors hover:border-ink"
                  >
                    {t("finder.startOver")}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="mt-[26px] text-[28px] font-semibold tracking-[-0.03em] text-balance">
                  {t(current.questionKey)}
                </h2>
                <div className="mt-[22px] grid grid-cols-2 gap-2.5">
                  {current.answers.map((a) => (
                    <button
                      key={a.value}
                      onClick={() => pick(a.value)}
                      className="min-h-16 rounded-xl border border-line p-3.5 text-left text-[16.5px] font-medium transition-colors hover:border-ink hover:bg-wash active:scale-[0.99]"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="mt-[22px] flex items-center justify-between">
                  <button
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="text-sm text-stone transition-colors hover:text-ink disabled:opacity-0"
                  >
                    {t("finder.back")}
                  </button>
                  <button
                    onClick={close}
                    className="text-sm text-stone transition-colors hover:text-ink"
                  >
                    {t("finder.skipBrowse")}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
