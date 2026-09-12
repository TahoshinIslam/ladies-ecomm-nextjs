"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../../lib/utils.js";

const Input = forwardRef(
  ({ className, type = "text", error, label, hint, icon: Icon, id, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    const inputType = isPassword && showPassword ? "text" : type;

    // Phase 10 — every field rendered through this shared component
    // previously had NO id/htmlFor association at all (label and input
    // were visually adjacent but programmatically unlinked) and no way
    // to connect a validation error to its field via aria-describedby/
    // aria-invalid. generatedId is only a fallback: a caller that already
    // passes its own `id` (several forms do, for label reuse elsewhere)
    // keeps using that exact id instead of getting a second, disconnected
    // one.
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint && !error ? `${inputId}-hint` : undefined;

    return (
      // `className` lands here, on the component's actual layout footprint
      // (every call site passes a layout utility — max-w-*, a grid
      // col-span — never something meant only for the inner <input>'s own
      // look), not on the input itself below: a hardcoded "w-full" there
      // ignored it completely, so a toolbar's "compact filter" max-width
      // silently never applied and every such field rendered full-width
      // instead — the exact bug behind "toolbar filters broken everywhere".
      <div className={cn("w-full", className)}>
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <div className="relative">
          {Icon && (
            <Icon aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          )}
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId || hintId || undefined}
            className={cn(
              "flex h-11 w-full rounded-lg border border-line bg-elev px-3.5 py-2 text-sm text-ink transition-colors placeholder:text-stone hover:border-ink/40 focus-ring disabled:opacity-50",
              Icon && "pl-10",
              isPassword && "pr-10",
              error && "border-danger",
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone transition-colors hover:text-ink focus-ring rounded"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="mt-1 text-xs text-stone">
            {hint}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
export default Input;
