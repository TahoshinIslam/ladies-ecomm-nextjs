import { cn } from "../../lib/utils.js";

// A plain presentational component (no hooks, no "use client") shared by
// both the home page's Server Component sections and its Client Component
// islands (e.g. ProductShowcaseSection) — safe to render from either side
// of the boundary since it owns no state of its own.
export default function SectionHead({ eyebrow, title, sub, aside, id, action, bordered }) {
  return (
    <div
      data-reveal
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 sm:gap-6",
        bordered && "border-b border-line pb-3 sm:pb-6",
      )}
    >
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2
          id={id}
          className="mt-2 text-[26px] font-semibold leading-none sm:mt-3.5 sm:text-[clamp(34px,3.4vw,48px)] tracking-[-0.03em]"
        >
          {title}
        </h2>
        {sub && <p className="mt-2 text-[14px] text-stone sm:mt-3 sm:text-lg">{sub}</p>}
      </div>
      {aside && (
        <p className="hidden max-w-[42ch] text-[15.5px] sm:block leading-[1.5] text-stone text-pretty">
          {aside}
        </p>
      )}
      {action}
    </div>
  );
}
