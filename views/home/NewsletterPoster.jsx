"use client";

// Phase 7 — a small, self-contained form island (email input + inline
// validation state); it depends on no page data at all, so it's
// unaffected by the rest of the home page's migration to server rendering.
import { useState } from "react";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";

export default function NewsletterPoster() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | loading | invalid | success

  const submit = (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("invalid");
      return;
    }
    setState("loading");
    // Wired to the notifications service in the backend phase.
    setTimeout(() => setState("success"), 600);
  };

  const note = {
    idle: t("home.newsletterNoteIdle"),
    invalid: t("home.newsletterNoteInvalid"),
    loading: t("home.newsletterNoteLoading"),
    success: t("home.newsletterNoteSuccess"),
  }[state];

  return (
    <section aria-labelledby="news-h" className="container-x pt-32">
      {/* Single column, not split against an empty second column — see the
          Campaign card above for why. */}
      <div
        data-reveal
        className="relative overflow-hidden rounded-[26px] bg-ink text-canvas"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 right-[6%] text-[300px] font-bold leading-[0.8] tracking-[-0.06em] opacity-[0.06]"
        >
          02
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 600 40"
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-10 w-full opacity-50"
        >
          <path
            d="M0 30 C 100 4, 200 40, 300 22 S 500 4, 600 26"
            fill="none"
            stroke="#FF3D21"
            strokeWidth="2"
          />
        </svg>

        <div className="relative max-w-[760px] px-8 py-16 sm:px-14">
          <div className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-verm">
            {t("home.newsletterEyebrow")}
          </div>
          <h2
            id="news-h"
            className="mt-4 text-[clamp(38px,4.2vw,60px)] font-semibold leading-[0.98] tracking-[-0.035em]"
          >
            {t("home.newsletterTitle")}
            <br />
            {t("home.newsletterTitleLine2")}
          </h2>
          <p className="mt-4 max-w-[38ch] text-[19px] leading-[1.5] text-[rgba(245,242,234,0.66)]">
            {t("home.newsletterBody")}
          </p>

          <form onSubmit={submit} className="mt-8 max-w-[520px]">
            <label
              htmlFor="nl"
              className="block font-mono text-[11px] uppercase tracking-[0.12em] text-[rgba(245,242,234,0.6)]"
            >
              {t("home.emailAddress")}
            </label>
            <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
              <input
                id="nl"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (state === "invalid") setState("idle");
                }}
                placeholder={t("home.emailPlaceholder")}
                aria-describedby="nl-note"
                aria-invalid={state === "invalid"}
                className={cn(
                  "h-[54px] flex-1 rounded-[9px] border bg-[rgba(245,242,234,0.06)] px-4 text-base text-canvas placeholder:text-[rgba(245,242,234,0.45)] focus-ring",
                  state === "invalid"
                    ? "border-verm"
                    : "border-[rgba(245,242,234,0.22)]",
                )}
              />
              <button
                type="submit"
                disabled={state === "loading"}
                className="h-[54px] whitespace-nowrap rounded-[9px] bg-verm-contrast px-6 text-[15.5px] font-semibold text-white transition-colors hover:bg-[#F5F2EA] hover:text-[#101012] focus-ring active:scale-[0.98] disabled:opacity-60"
              >
                {state === "success" ? t("home.subscribed") : t("home.signUp")}
              </button>
            </div>
            <div
              id="nl-note"
              role="status"
              className={cn(
                "mt-3 text-[13.5px] leading-[1.5]",
                state === "invalid"
                  ? "text-verm"
                  : "text-[rgba(245,242,234,0.6)]",
              )}
            >
              {note}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
