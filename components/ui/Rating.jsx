import { Star } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * Stars fill in vermillion rather than the usual amber — the board has no
 * yellow, and rating rows sit directly beside price and Just-landed chips.
 */
export default function Rating({
  value = 0,
  size = 14,
  showValue = false,
  text,
  className,
}) {
  const v = Number(value) || 0;

  return (
    <div
      className={cn("inline-flex items-center gap-1.5", className)}
      role="img"
      aria-label={`Rated ${v.toFixed(1)} out of 5`}
    >
      <div className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = v >= n;
          const half = !filled && v >= n - 0.5;
          return (
            <span
              key={n}
              className="relative inline-block"
              style={{ width: size, height: size }}
            >
              <Star
                size={size}
                className="absolute inset-0 text-line"
                strokeWidth={1.5}
              />
              {(filled || half) && (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: half ? size / 2 : size }}
                >
                  <Star
                    size={size}
                    className="fill-verm text-verm"
                    strokeWidth={1.5}
                  />
                </span>
              )}
            </span>
          );
        })}
      </div>
      {showValue && (
        <span data-tabular className="text-xs font-semibold text-ink">
          {v.toFixed(1)}
        </span>
      )}
      {text && <span className="text-xs text-stone">{text}</span>}
    </div>
  );
}
