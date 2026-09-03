"use client";

import { forwardRef, useEffect, useRef } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * A styled checkbox that supports the native `indeterminate` visual state
 * (not expressible as a plain HTML attribute — has to be set imperatively
 * on the DOM node), used for a DataTable's "select all on this page" header
 * checkbox when only some rows are selected.
 */
const Checkbox = forwardRef(
  ({ checked = false, indeterminate = false, onChange, className, ...props }, forwardedRef) => {
    const innerRef = useRef(null);

    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = !!indeterminate && !checked;
    }, [indeterminate, checked]);

    return (
      <span className={cn("relative inline-flex h-4 w-4 flex-none items-center justify-center", className)}>
        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof forwardedRef === "function") forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
          }}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-line bg-elev transition-colors checked:border-ink checked:bg-ink focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute h-3 w-3 text-canvas opacity-0 peer-checked:opacity-100"
        />
        {indeterminate && !checked && (
          <Minus aria-hidden="true" strokeWidth={3} className="pointer-events-none absolute h-3 w-3 text-ink" />
        )}
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";
export default Checkbox;
