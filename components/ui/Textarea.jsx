import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

const Textarea = forwardRef(
  ({ className, label, error, hint, rows = 4, ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-ring disabled:opacity-50",
          error && "border-danger focus:ring-danger",
          className
        )}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
);
Textarea.displayName = "Textarea";
export default Textarea;
