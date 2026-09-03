import { cn } from "../../lib/utils.js";

/**
 * Zero/error state for lists and grids. Renders a hatched media plate behind
 * the icon so an empty region still reads as part of the editorial system
 * rather than as a hole in the page.
 */
export default function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  className,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-20 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border border-line bg-media">
          <div aria-hidden="true" className="absolute inset-0 hatch" />
          <Icon className="relative h-6 w-6 text-stone" strokeWidth={1.6} />
        </div>
      )}
      {title && (
        <h3 className="mt-6 text-xl font-semibold tracking-[-0.025em] text-ink">
          {title}
        </h3>
      )}
      {message && (
        <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-stone">
          {message}
        </p>
      )}
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}
