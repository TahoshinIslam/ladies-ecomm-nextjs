import { cn } from "../../lib/utils.js";

/**
 * Board badges are square-ish mono chips (Just landed, Feature, Sale), not
 * pills — the 6px radius and 0.1em tracking are what make them read as labels
 * rather than buttons.
 */
const variants = {
  default: "bg-media text-stone",
  primary: "bg-ink text-canvas",
  accent: "bg-verm text-white",
  lime: "bg-lime text-[#101012]",
  success: "border border-success/30 bg-success/15 text-success",
  warning: "border border-warning/30 bg-warning/15 text-warning",
  danger: "border border-danger/30 bg-danger/15 text-danger",
  outline: "border border-line text-ink",
};

export default function Badge({
  variant = "default",
  className,
  children,
  ...props
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em]",
        variants[variant] ?? variants.default,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
