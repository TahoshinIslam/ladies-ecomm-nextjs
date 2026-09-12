"use client";

import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * Native <select> in the editorial field style — same height, radius and border
 * treatment as Input so the two line up when mixed in a form row.
 *
 * Stays uncontrolled-friendly and forwards its ref, so it drops straight into
 * react-hook-form via {...register("field")}.
 */
const Select = forwardRef(
  ({ className, error, label, hint, children, ...props }, ref) => {
    return (
      // See components/ui/Input.jsx's matching comment: `className` belongs
      // on this outer box (the thing a flex/grid parent actually lays out —
      // every call site passes a layout utility like max-w-* or a grid
      // col-span), not only on the inner <select> below. A hardcoded
      // "w-full" here previously ignored it, so every "compact" filter
      // dropdown across the admin tables rendered full-width regardless.
      <div className={cn("w-full", className)}>
        {label && (
          <label className="mb-1.5 block text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={cn(
              "h-11 w-full appearance-none rounded-lg border border-line bg-elev px-3 pr-9 text-sm text-ink transition-colors focus-ring disabled:opacity-50",
              "hover:border-ink/40",
              error && "border-danger",
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone"
          />
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-stone">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";
export default Select;
