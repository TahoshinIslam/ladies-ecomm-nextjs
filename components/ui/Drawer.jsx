"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Drawer({
  open,
  onClose,
  side = "right",
  title,
  children,
  className,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Keep Tab cycling inside the panel — without this, focus can walk out
  // into the (visually hidden, but still tabbable) page behind the overlay.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement;
    const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE));
    focusables()[0]?.focus();

    const onKeydown = (e) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeydown);
    return () => {
      panel.removeEventListener("keydown", onKeydown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const fromX = side === "right" ? "100%" : "-100%";
  const align = side === "right" ? "right-0" : "left-0";

  return (
    <AnimatePresence>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[210]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-[3px]"
          />
          <motion.aside
            ref={panelRef}
            initial={{ x: fromX }}
            animate={{ x: 0 }}
            exit={{ x: fromX }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute top-0 flex h-full w-full max-w-[468px] flex-col bg-surface shadow-soft",
              align,
              className,
            )}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <h3 className="text-[22px] font-semibold tracking-[-0.025em]">{title}</h3>
              {onClose && (
                <button
                  onClick={onClose}
                  aria-label={`Close ${title || "panel"}`}
                  className="grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
