"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../../lib/utils.js";

const Input = forwardRef(
  ({ className, type = "text", error, label, hint, icon: Icon, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    const inputType = isPassword && showPassword ? "text" : type;

    return (
      <div className="w-full">
        {label && (
          <label className="mb-1.5 block text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <div className="relative">
          {Icon && (
            <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          )}
          <input
            ref={ref}
            type={inputType}
            className={cn(
              "flex h-11 w-full rounded-lg border border-line bg-elev px-3.5 py-2 text-sm text-ink transition-colors placeholder:text-stone hover:border-ink/40 focus-ring disabled:opacity-50",
              Icon && "pl-10",
              isPassword && "pr-10",
              error && "border-danger",
              className
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
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
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-stone">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
export default Input;
