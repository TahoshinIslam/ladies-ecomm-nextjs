"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * Compact icon-trigger action menu — collapses a row's View/Edit/Delete
 * buttons into one "⋯" control. No Radix in this project (see
 * components/layout/Header.jsx's MegaTrigger for the same hand-rolled
 * click-toggle + outside-click + Escape pattern this follows), so this is
 * a small self-contained popover rather than a third-party primitive.
 */
export default function DropdownMenu({ trigger, triggerLabel = "Open actions menu", align = "end", className, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring",
          className,
        )}
      >
        {trigger || <MoreHorizontal aria-hidden="true" className="h-4 w-4" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className={cn(
              "absolute z-20 mt-1 min-w-[168px] overflow-hidden rounded-lg border border-border bg-background p-1 shadow-soft",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DropdownMenuItem({ icon: Icon, danger = false, className, children, ...props }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "text-danger hover:bg-danger/10" : "text-foreground hover:bg-muted",
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden="true" className="h-4 w-4 flex-none" />}
      {children}
    </button>
  );
}
