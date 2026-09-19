"use client";

// "All Categories" — the storefront's one shared entry point into the full
// department/style tree (same CategoryDrillMenu.jsx underneath as the rest
// of the app: same icons, same green hover/active treatment, same 3-level
// drill-down). Rendered in the header's nav row on every storefront page
// (not just /shop), replacing the old per-page mega menu.
//
// Interaction contract (desktop, hover-capable + fine pointer only):
//  - Closed by default; never opens just because the trigger receives Tab
//    focus (Enter/Space and mouse click/hover are the only openers).
//  - Hovering the trigger opens it unpinned. Moving the pointer away (from
//    either the trigger or the open panel) closes it again after a short
//    delay, long enough to cross the visual gap between them without
//    flicker.
//  - Clicking while closed opens AND pins it. Clicking again while it's
//    open-but-unpinned (hover already opened it) pins it without closing.
//    Clicking a third time (now pinned) closes it, and — since the pointer
//    is typically still over the trigger at that moment — suppresses hover
//    from silently reopening it until the pointer actually leaves first.
//  - Once pinned, only an explicit close (trigger click, outside click,
//    Escape, or a route change) closes it — hovering away no longer does.
//  - Escape closes it and returns focus to the trigger; an outside click
//    closes it without stealing focus from whatever was clicked.
//  - Losing keyboard focus entirely (Tab out of both the trigger and the
//    open panel) closes it.
// This is a genuinely different combination (hover-open AND click-toggle
// together) than either of this codebase's existing hand-rolled patterns
// (components/ui/DropdownMenu.jsx is click-only; the old version of this
// component was hover-only) — no third-party primitive is used, matching
// this project's established "no Radix" convention.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, LayoutGrid } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";
import CategoryDrillMenu from "./CategoryDrillMenu.jsx";

const CLOSE_DELAY_MS = 180;

export default function HeaderCategoryMenu({ categories, className }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Set the instant the trigger explicitly closes a pinned panel while the
  // pointer is still over it; cleared on the next real mouseleave. While
  // true, hovering (without leaving first) must not silently reopen it.
  const suppressHoverRef = useRef(false);
  const closeTimerRef = useRef(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const close = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
    setPinned(false);
  }, []);

  useEffect(() => clearCloseTimer, []);

  // Route change (including a real navigation from inside the panel, or a
  // browser back/forward) always closes it — CategoryDrillMenu's own
  // onNavigate already closes on click, this is the safety net for
  // anything that changes the URL without going through that callback.
  // Adjusted during render (React's own "reset state when a prop changes"
  // pattern — see Header.jsx's matching `lastPath` handling) rather than in
  // an effect, so the panel never paints open for one frame on the new page
  // before an effect gets a chance to run.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    // Plain setState only (no ref access — refs can't be read during
    // render): a stray pending close-timer callback firing afterward just
    // sets the already-false `open` again, which is harmless.
    if (open) setOpen(false);
    if (pinned) setPinned(false);
  }

  // Escape — closes and restores focus to the trigger, regardless of which
  // element inside the panel currently has focus (this listens on the
  // document, so it fires no matter how deep the keyboard focus is).
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Outside click — closes without touching focus, so whatever was clicked
  // keeps whatever focus behavior it would naturally get.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  if (!categories?.some((c) => !c.parent)) return null;

  const hoverCapable = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

  const handleMouseEnter = () => {
    clearCloseTimer();
    if (pinned || suppressHoverRef.current || !hoverCapable()) return;
    setOpen(true);
  };

  const handleMouseLeave = () => {
    // The pointer has genuinely left the trigger+panel region — whatever
    // suppressed a reopen while it lingered no longer applies next time.
    suppressHoverRef.current = false;
    if (pinned) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const handleTriggerClick = () => {
    clearCloseTimer();
    if (!open) {
      setOpen(true);
      setPinned(true);
      return;
    }
    if (!pinned) {
      // Hover already opened it — the first click just pins it open.
      setPinned(true);
      return;
    }
    // Already pinned — this click explicitly closes it.
    setOpen(false);
    setPinned(false);
    suppressHoverRef.current = true;
  };

  // Losing focus to something outside the trigger+panel closes it — a
  // keyboard user tabbing past the last link inside shouldn't leave it
  // open and orphaned. `relatedTarget` is the element gaining focus; a
  // pointer-driven blur (e.g. clicking outside) can leave it null, which
  // the outside-click handler above already covers.
  const handleBlur = (e) => {
    const next = e.relatedTarget;
    if (next && containerRef.current?.contains(next)) return;
    close();
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        // Matches Header.jsx's <nav aria-label="Primary"> text sizing/weight
        // directly, rather than relying on inheriting it — this trigger
        // renders outside that <nav>, so it would otherwise fall back to
        // the page's default text size instead of matching Home/Shop/New/
        // Deals/Contact beside it.
        className="flex h-11 items-center gap-1.5 text-[14.5px] font-medium text-ink transition-colors hover:text-verm focus-ring"
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        {t("header.allCategories")}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={panelId} className="absolute left-0 top-full z-[110] pt-2">
          {/* Fixed height (not max-height + overflow on THIS wrapper): the
              vertical scrolling for a long department list already happens
              inside CategoryDrillMenu's own <ul> — overflow set here too
              would clip the mid/right flyout columns, which escape this
              box horizontally via `left-full` and depend on this wrapper
              staying `overflow-visible`. Shrinks on short viewports so the
              panel never runs off the bottom of the screen; the internal
              list scrolls to compensate.
              Confirmed feedback, reverted: this used to measure the
              homepage hero carousel at runtime and match this height to
              it, which made the panel visibly taller on the homepage
              (up to 560px) than on every other page (a flat 420px) — one
              fixed height everywhere now, matching the hero's own former
              max height, so the panel is identical regardless of page. */}
          <div className="h-[min(560px,calc(100vh-220px))] w-[272px] overflow-visible rounded-[22px] border border-line bg-surface shadow-hover">
            <CategoryDrillMenu categories={categories} onNavigate={close} className="h-full w-full flex-col" />
          </div>
        </div>
      )}
    </div>
  );
}
