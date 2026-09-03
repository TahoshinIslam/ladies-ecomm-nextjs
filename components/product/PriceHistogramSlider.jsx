"use client";

import { useMemo, useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { formatCurrency, cn } from "../../lib/utils.js";

// Histogram-backed dual-thumb price range filter.
//
// Visual matches the user's reference: a tall row of skinny bars, the ones
// inside the selected window painted with the theme `accent`, the ones
// outside dimmed; a thin accent track between two solid circular thumbs,
// and bold min/max amounts below.
export default function PriceHistogramSlider({
  products = [],
  value,
  onChange,
  currency = "USD",
  bins = 28,
}) {
  const [open, setOpen] = useState(true);

  // Catalog bounds come from products; bar heights are purely decorative —
  // a fixed mix of short / medium / long bars so the visual is always full
  // regardless of how prices are actually distributed.
  const { min, max, heights } = useMemo(() => {
    const prices = products
      .map((p) => Number(p.discountPrice ?? p.basePrice))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const lo = prices.length ? Math.floor(Math.min(...prices)) : 0;
    const hi = prices.length ? Math.ceil(Math.max(...prices)) : 100;

    // Deterministic pseudo-random pattern: blends a sine wave with an
    // integer-hash jitter so heights look varied but stable between renders.
    //
    // The jitter used to be `sin(i * 12.9898) * 43758.5453 % 1` — the classic
    // GLSL noise hack. It's a bad fit for React SSR: Math.sin on an argument
    // this large depends on the platform's libm for argument reduction, which
    // isn't guaranteed bit-identical across engines. Node (server render) and
    // the browser (hydration) landed on slightly different floats, and %1
    // amplifies that into a visible mismatch — the hydration-mismatch warning
    // this was throwing. Bitwise integer ops are exact per spec on every
    // engine, so this hash can't disagree between server and client.
    const hashInt = (n) => {
      let x = (n | 0) + 0x9e3779b9;
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
      x = x ^ (x >>> 16);
      return (x >>> 0) / 4294967295; // 0..1
    };
    const h = new Array(bins).fill(0).map((_, i) => {
      const wave = (Math.sin(i * 0.9) + 1) / 2; // 0..1
      const jitter = hashInt(i);
      const mix = wave * 0.6 + jitter * 0.4;
      // Stay in 35..100% so no bar looks empty
      return 35 + mix * 65;
    });
    return { min: lo, max: hi, heights: h };
  }, [products, bins]);

  const safeMax = max > min ? max : min + 1;
  const [lo, setLo] = useState(value?.[0] ?? min);
  const [hi, setHi] = useState(value?.[1] ?? safeMax);

  useEffect(() => {
    setLo(value?.[0] ?? min);
    setHi(value?.[1] ?? safeMax);
  }, [value, min, safeMax]);

  const pct = (v) => ((v - min) / (safeMax - min)) * 100;

  const commit = useCallback(
    (a, b) => {
      const finalLo = Math.min(a, b);
      const finalHi = Math.max(a, b);
      onChange?.([
        finalLo === min ? null : finalLo,
        finalHi === safeMax ? null : finalHi,
      ]);
    },
    [onChange, min, safeMax],
  );

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-3 flex w-full items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>
          Price <span className="opacity-40">·</span> {currency}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      {open && (
        <>
          {/* Decorative histogram — short/medium/long mix */}
          <div className="relative flex h-20 items-end gap-[2px]">
            {heights.map((h, i) => {
              const binStart = min + ((safeMax - min) * i) / bins;
              const binEnd = min + ((safeMax - min) * (i + 1)) / bins;
              const inRange = binEnd > lo && binStart < hi;
              return (
                <div
                  key={i}
                  // Fixed precision, not the raw float: Next's SSR HTML and
                  // the client's hydration render this same number as
                  // different-length strings (e.g. "55.0389%" vs
                  // "55.038867718431455%" — equal values, just formatted at
                  // different precision), which React's hydration check
                  // flags as a mismatch. Rounding first makes both passes
                  // produce the identical string.
                  style={{ height: `${h.toFixed(4)}%` }}
                  className={cn(
                    "flex-1 rounded-[1px] transition-colors",
                    inRange ? "bg-accent" : "bg-accent/25",
                  )}
                />
              );
            })}
          </div>

          {/* Slider — h-5 (20px) so the 18px thumbs sit centered on the 2px track line */}
          <div className="relative mt-3 h-5">
            <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-accent/25" />
            <div
              className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-accent"
              style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
            />
            <input
              type="range"
              min={min}
              max={safeMax}
              value={lo}
              step={1}
              onChange={(e) => setLo(Math.min(Number(e.target.value), hi - 1))}
              onMouseUp={() => commit(lo, hi)}
              onTouchEnd={() => commit(lo, hi)}
              onKeyUp={() => commit(lo, hi)}
              aria-label="Minimum price"
              className="price-range-input absolute left-0 top-0 w-full focus:outline-none"
            />
            <input
              type="range"
              min={min}
              max={safeMax}
              value={hi}
              step={1}
              onChange={(e) => setHi(Math.max(Number(e.target.value), lo + 1))}
              onMouseUp={() => commit(lo, hi)}
              onTouchEnd={() => commit(lo, hi)}
              onKeyUp={() => commit(lo, hi)}
              aria-label="Maximum price"
              className="price-range-input absolute left-0 top-0 w-full focus:outline-none"
            />
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-sm">
              <span className="font-bold text-foreground">
                {formatCurrency(lo, currency)}
              </span>{" "}
              <span className="text-xs font-medium text-muted-foreground">
                min
              </span>
            </span>
            <span className="text-sm">
              <span className="font-bold text-foreground">
                {formatCurrency(hi, currency)}
              </span>{" "}
              <span className="text-xs font-medium text-muted-foreground">
                max
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
