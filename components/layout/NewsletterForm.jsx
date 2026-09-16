"use client";

import { useState } from "react";

import Button from "../ui/Button.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";

/**
 * Shared subscribe form — used inline in the footer's newsletter column and
 * as the home page's standalone "Stay updated" band (EShopper's own
 * composition has both). Same validation/simulated-success state machine
 * either place; `theme` only changes input/text contrast for a dark
 * (bg-verm) vs light (bg-canvas/bg-surface) surface.
 */
export default function NewsletterForm({ theme = "dark", className }) {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | invalid | loading | success

  const submit = (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("invalid");
      return;
    }
    setState("loading");
    setTimeout(() => setState("success"), 500);
  };

  const note = {
    idle: t("home.newsletterNoteIdle"),
    invalid: t("home.newsletterNoteInvalid"),
    loading: t("home.newsletterNoteLoading"),
    success: t("home.newsletterNoteSuccess"),
  }[state];

  const isDark = theme === "dark";

  return (
    <form onSubmit={submit} className={className}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "invalid") setState("idle");
          }}
          aria-label={t("home.emailAddress")}
          aria-invalid={state === "invalid"}
          placeholder={t("home.emailPlaceholder")}
          className={cn(
            "h-11 min-w-0 flex-1 rounded-lg border px-3.5 text-[14px] focus-ring",
            isDark
              ? "bg-[rgba(250,250,247,0.08)] text-accent-foreground placeholder:text-accent-foreground/50"
              : "bg-surface text-ink placeholder:text-stone",
            state === "invalid" ? "border-danger" : isDark ? "border-[rgba(250,250,247,0.25)]" : "border-line",
          )}
        />
        <Button type="submit" variant="promo" disabled={state === "loading"}>
          {state === "success" ? t("home.subscribed") : t("home.signUp")}
        </Button>
      </div>
      <p
        className={cn(
          "mt-2.5 text-[12.5px] leading-[1.5]",
          isDark ? "text-accent-foreground/70" : "text-stone",
        )}
      >
        {note}
      </p>
    </form>
  );
}
