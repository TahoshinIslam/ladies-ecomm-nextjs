"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { setFinderOpen } from "../../store/uiSlice.js";
import { useGetProductsQuery } from "../../store/productApi.js";
import { useSettings } from "../../context/SettingsContext.jsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const QUESTIONS = [
  {
    q: "How do you move most days?",
    a: ["Commuting", "Logging miles", "Standing all day", "Nights out"],
  },
  {
    q: "Which silhouette pulls you?",
    a: ["Retro runner", "Low terrace", "Technical trail", "Court classic"],
  },
  {
    q: "Budget per pair",
    a: ["Under $120", "$120–180", "$180+", "No ceiling"],
  },
];

const BUDGET_FILTER = {
  "Under $120": { priceMax: 120 },
  "$120–180": { priceMin: 120, priceMax: 180 },
  "$180+": { priceMin: 180 },
  "No ceiling": {},
};

const CATEGORY_HINT = {
  "Retro runner": "everyday",
  "Low terrace": "everyday",
  "Technical trail": "performance",
  "Court classic": "statement",
};

/**
 * Three questions, no account needed — matches the board's guided-discovery
 * dialog exactly. Mounted once in the storefront layout, like the cart and
 * search overlays, and opened from the hero's "Find my pair" button.
 */
export default function ProductFinder() {
  const open = useSelector((s) => s.ui.finderOpen);
  const dispatch = useDispatch();
  const settings = useSettings();
  const panelRef = useRef(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState([]);

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
  const budgetAnswer = answers[2];
  const categoryHint = CATEGORY_HINT[answers[1]];

  const query = useMemo(() => {
    const budget = BUDGET_FILTER[budgetAnswer] ?? {};
    return { ...budget, category: categoryHint, limit: 3 };
  }, [budgetAnswer, categoryHint]);

  const { data, isFetching } = useGetProductsQuery(query, { skip: !done });
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

  const pick = (label) => {
    setAnswers((prev) => [...prev.slice(0, step), label]);
    setStep((s) => s + 1);
  };

  const restart = () => {
    setStep(0);
    setAnswers([]);
  };

  const progress = done ? 100 : (step / QUESTIONS.length) * 100;
  const current = QUESTIONS[step];

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
            aria-label="Find my pair"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[620px] rounded-[20px] border border-line bg-surface p-[34px] shadow-soft"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                {done ? "Your matches" : `Step ${step + 1} of ${QUESTIONS.length}`}
              </span>
              <button
                onClick={close}
                aria-label="Close finder"
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
                  {isFetching ? "…" : picks.length} in your lane
                </h2>
                <p className="mt-2.5 text-[15.5px] text-stone">
                  Based on {answers.join(", ").toLowerCase()}.
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
                            <span aria-hidden="true" className="absolute inset-0 hatch" />
                          </span>
                          <span className="flex-1">
                            <span className="block font-mono text-[10.5px] uppercase tracking-[0.12em] text-stone">
                              {p.brand?.name}
                            </span>
                            <span className="mt-1 block text-base font-semibold">
                              {p.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-stone">
                              {p.colorway}
                            </span>
                          </span>
                          <span data-tabular className="text-[15.5px] font-semibold">
                            {settings.formatPrice(p.discountPrice ?? p.basePrice)}
                          </span>
                        </Link>
                      ))}
                  {!isFetching && picks.length === 0 && (
                    <p className="rounded-xl border border-line p-4 text-sm text-stone">
                      Nothing matched exactly — browse the full rotation instead.
                    </p>
                  )}
                </div>
                <div className="mt-6 flex gap-2.5">
                  <Link
                    href="/shop"
                    onClick={close}
                    className="flex h-[50px] flex-1 items-center justify-center rounded-[9px] bg-verm text-[15px] font-semibold text-white transition-colors hover:bg-ink hover:text-canvas"
                  >
                    See these pairs
                  </Link>
                  <button
                    onClick={restart}
                    className="h-[50px] rounded-[9px] border border-line px-5 text-[14.5px] font-semibold transition-colors hover:border-ink"
                  >
                    Start over
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="mt-[26px] text-[28px] font-semibold tracking-[-0.03em] text-balance">
                  {current.q}
                </h2>
                <div className="mt-[22px] grid grid-cols-2 gap-2.5">
                  {current.a.map((label) => (
                    <button
                      key={label}
                      onClick={() => pick(label)}
                      className="min-h-16 rounded-xl border border-line p-3.5 text-left text-[16.5px] font-medium transition-colors hover:border-ink hover:bg-wash active:scale-[0.99]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-[22px] flex items-center justify-between">
                  <button
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="text-sm text-stone transition-colors hover:text-ink disabled:opacity-0"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={close}
                    className="text-sm text-stone transition-colors hover:text-ink"
                  >
                    Skip, just let me browse
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
