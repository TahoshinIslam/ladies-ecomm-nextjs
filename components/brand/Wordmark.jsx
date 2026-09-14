import { cn } from "../../lib/utils.js";

/**
 * Leo Store design system's wordmark treatment: Manrope extrabold, tight
 * tracking, brand-green accent on the trailing period — no pictorial logo.
 * The store's real name ("TAHOS.") already ends in a period, so this splits
 * that off and colors it, rather than appending a second one; a configured
 * name without a trailing period renders plain.
 */
export default function Wordmark({ name, className, onAccent = false, ...props }) {
  const hasDot = name.endsWith(".");
  const base = hasDot ? name.slice(0, -1) : name;

  return (
    <span
      className={cn(
        "font-heading font-extrabold tracking-[-0.03em]",
        onAccent ? "text-accent-foreground" : "text-ink",
        className,
      )}
      {...props}
    >
      {base}
      {/* On a solid accent-green surface, the dot needs the chartreuse
          promo color instead — verm-on-verm would vanish. */}
      {hasDot && <span className={onAccent ? "text-lime" : "text-verm"}>.</span>}
    </span>
  );
}
