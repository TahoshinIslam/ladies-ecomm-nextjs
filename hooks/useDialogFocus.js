"use client";

import { useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Phase 10 — one reusable focus-management hook for every modal-style
 * overlay (dialog/sheet/menu), replacing several independent, partially
 * correct implementations (components/ui/Drawer.jsx had the full
 * pattern; components/layout/SearchModal.jsx never restored focus on
 * close; components/product/QuickAddSheet.jsx and
 * components/product/ProductFinder.jsx never moved focus in OR restored
 * it). On open: moves focus to the first focusable element inside
 * `panelRef` (or a specific `initialFocusRef` when the first tabbable
 * element isn't the right one to land on, e.g. a search input that isn't
 * first in DOM order), traps Tab/Shift+Tab inside the panel, and closes
 * on Escape. On close: restores focus to whatever had it before the
 * dialog opened — the one fix this consolidation actually needed to make
 * everywhere.
 */
export default function useDialogFocus({ open, panelRef, onClose, initialFocusRef, lockScroll = true }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    if (lockScroll) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (lockScroll) document.body.style.overflow = "";
    };
  }, [open, onClose, lockScroll]);

  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;

    const previouslyFocused = document.activeElement;
    const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE));
    (initialFocusRef?.current || focusables()[0])?.focus();

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
  }, [open, panelRef, initialFocusRef]);
}
