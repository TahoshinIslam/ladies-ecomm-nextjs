"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils.js";

const PANEL_MAX_HEIGHT = 280;

/**
 * Compact icon-trigger action menu — collapses a row's View/Edit/Delete
 * buttons into one "⋯" control. No Radix in this project (see
 * components/layout/Header.jsx's MegaTrigger for the same hand-rolled
 * click-toggle + outside-click + Escape pattern this follows), so this is
 * a small self-contained popover rather than a third-party primitive.
 *
 * Portaled to document.body (position: fixed, computed from the trigger's
 * own getBoundingClientRect — same approach as components/ui/Select.jsx's
 * listbox) rather than absolutely positioned inside this component's own
 * DOM position: every real usage of this menu lives inside DataTable.jsx's
 * scrollable table wrapper (`overflow-x-auto`, and `overflow-y-auto` on
 * admin tables), which clipped the menu's panel for any row near the
 * table's own bottom/right edge — visually invisible even though the
 * "Edit"/"Delete" items were still present in the DOM, exactly the
 * "edit is not visible" bug reported against the admin Products table.
 * Flips to open upward when there isn't enough room below, and recomputes
 * on scroll/resize so it never drifts from its trigger.
 */
export default function DropdownMenu({ trigger, triggerLabel = "Open actions menu", align = "end", className, children }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const updatePanelStyle = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < PANEL_MAX_HEIGHT && rect.top > spaceBelow;
    setPanelStyle({
      position: "fixed",
      minWidth: 168,
      maxHeight: PANEL_MAX_HEIGHT,
      ...(align === "end" ? { right: window.innerWidth - rect.right } : { left: rect.left }),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => updatePanelStyle();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = () => {
    if (!open) updatePanelStyle();
    setOpen((v) => !v);
  };

  return (
    <div className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
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
      {open &&
        panelStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={panelRef}
              role="menu"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              style={panelStyle}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="z-[300] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-soft"
            >
              {children}
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
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
