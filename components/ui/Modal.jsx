"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
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

  // Keep Tab cycling inside the dialog rather than escaping to the page
  // behind the overlay.
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

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    full: "max-w-[95vw]",
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-[3px]"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft",
              sizes[size],
              className,
            )}
          >
            {(title || onClose) && (
              <div className="flex items-start justify-between border-b border-line p-6">
                <div>
                  {title && (
                    <h3 className="text-lg font-semibold tracking-[-0.02em]">{title}</h3>
                  )}
                  {description && (
                    <p className="mt-1 text-sm text-stone">{description}</p>
                  )}
                </div>
                {onClose && (
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="grid h-11 w-11 flex-none place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
