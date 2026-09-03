"use client";

import { useSettings } from "../../context/SettingsContext.jsx";

/**
 * Small currency toggle for the header. Shows "৳ BDT" / "$ USD" pill that
 * cycles between the two on click. User choice is persisted in localStorage.
 */
export default function CurrencySwitcher({ className = "" }) {
  const { activeCurrency, setActiveCurrency } = useSettings();

  const next = activeCurrency === "BDT" ? "USD" : "BDT";
  const label = activeCurrency === "BDT" ? "৳ BDT" : "$ USD";

  return (
      <button
      onClick={() => setActiveCurrency(next)}
      aria-label={`Switch currency to ${next}`}
      title={`Switch to ${next}`}
      className={
        "h-11 shrink-0 whitespace-nowrap rounded-lg border border-line bg-elev px-3 text-[14.5px] font-medium text-ink transition-colors hover:border-ink focus-ring " +
        className
      }
    >
      {label}
    </button>
  );
}
