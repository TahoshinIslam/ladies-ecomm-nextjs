"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, Minus, Move, Plus, RotateCcw } from "lucide-react";

import Button from "../../ui/Button.jsx";
import FramedImage from "../../ui/FramedImage.jsx";
import { cn, resolveImage } from "../../../lib/utils.js";
import { measureImageUrl } from "../../../lib/imageFileInfo.js";
import {
  FREE_HANDLES,
  MAX_ZOOM,
  MIN_ZOOM,
  checkResolution,
  defaultFraming,
  formatAspect,
  getPlacement,
  moveFreeBox,
  panFraming,
  recommendedSource,
  resizeFreeBox,
  sanitizeFraming,
  setFramingMode,
  stretchAmount,
  zoomFraming,
} from "../../../lib/imageFraming.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stretch-mode handles: where each sits on the image box, its cursor, and the
// keys that move its edge(s) (ArrowRight/Left act on a right/left edge, etc.).
const HANDLE_META = {
  n: { label: "top edge", cursor: "ns-resize" },
  s: { label: "bottom edge", cursor: "ns-resize" },
  w: { label: "left edge", cursor: "ew-resize" },
  e: { label: "right edge", cursor: "ew-resize" },
  nw: { label: "top-left corner", cursor: "nwse-resize" },
  se: { label: "bottom-right corner", cursor: "nwse-resize" },
  ne: { label: "top-right corner", cursor: "nesw-resize" },
  sw: { label: "bottom-left corner", cursor: "nesw-resize" },
};
const KEY_DELTAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const clamp01 = (n) => Math.min(1, Math.max(0, n));

const LEVEL_STYLE = {
  ok: { Icon: CheckCircle2, className: "text-success" },
  low: { Icon: AlertTriangle, className: "text-amber-600" },
  insufficient: { Icon: AlertTriangle, className: "text-danger" },
};

/**
 * The framing editor: shows the DESTINATION frame at its exact aspect ratio,
 * lets the admin drag / zoom / choose Fit or Fill, and reports the result. It
 * renders through the same FramedImage the storefront uses, so what is shown
 * here is what the site will show. Pointer events cover mouse, touch (drag +
 * two-finger pinch) and pen; the frame is also keyboard operable.
 *
 * Nothing is saved or uploaded here — the parent decides what Save means, and
 * Cancel just closes, so cancelling can never overwrite an existing image.
 *
 * `placements`: one or more destination keys (tabs when several).
 * `source`: { url, width?, height? } — dimensions are measured when omitted.
 * `initialFramings`: saved framing per placement (or nothing = unframed).
 * `persistAll`: also return defaults for placements the admin never opened
 *   (a brand-new image gets explicit framing everywhere; an existing image
 *   only changes the placements that were actually edited).
 */
export default function ImageFramingEditor({
  placements,
  source,
  initialFramings = {},
  persistAll = false,
  saving = false,
  error = "",
  saveLabel = "Save framing",
  title = "Frame image",
  onSave,
  onCancel,
}) {
  const [dims, setDims] = useState(source.width && source.height ? { width: source.width, height: source.height } : null);
  const [measureError, setMeasureError] = useState("");
  const [active, setActive] = useState(placements[0]);
  const [edits, setEdits] = useState({});
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);

  const panelRef = useRef(null);
  const frameRef = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const boxDrag = useRef(null); // stretch mode: { handle | "move", id, x0, y0, start }
  const currentRef = useRef(null);
  const frameSizeRef = useRef(frameSize);
  const cancelRef = useRef(onCancel);
  const titleId = useId();

  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    frameSizeRef.current = frameSize;
  }, [frameSize]);

  useEffect(() => {
    if (dims) return undefined;
    let cancelled = false;
    // Original (untransformed) file so the resolution check is about real pixels.
    measureImageUrl(resolveImage(source.url))
      .then((d) => !cancelled && setDims(d))
      .catch((e) => !cancelled && setMeasureError(e.message));
    return () => {
      cancelled = true;
    };
  }, [dims, source.url]);

  const placement = getPlacement(active);
  const framingFor = useCallback(
    (key) => edits[key] || sanitizeFraming(initialFramings[key]) || (dims ? defaultFraming(key, dims) : null),
    [edits, initialFramings, dims],
  );
  const current = dims ? framingFor(active) : null;

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // Track the rendered frame size for drag maths.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    // ResizeObserver reports the initial size as soon as it starts observing.
    const ro = new ResizeObserver(() => setFrameSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims, active]);

  // Modal behaviour: capture-phase key handling so a parent modal underneath
  // never also reacts to this dialog's Escape/Tab; focus trap; scroll lock;
  // focus restored on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        cancelRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      e.stopPropagation();
      const items = Array.from(panelRef.current.querySelectorAll(FOCUSABLE));
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
    document.addEventListener("keydown", onKey, true);
    const raf = requestAnimationFrame(() => (frameRef.current || panelRef.current)?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const commit = useCallback(
    (next) => {
      if (!next) return;
      currentRef.current = next;
      setEdits((prev) => ({ ...prev, [active]: next }));
    },
    [active],
  );

  const applyPan = (dx, dy) => {
    const { w, h } = frameSizeRef.current;
    if (currentRef.current && w && h) commit(panFraming(currentRef.current, dx, dy, w, h));
  };
  const applyZoom = (z) => {
    const { w, h } = frameSizeRef.current;
    if (currentRef.current && w && h) commit(zoomFraming(currentRef.current, z, w, h));
  };

  // Stretch mode: dragging the picture moves it; dragging a handle resizes it.
  const startBoxDrag = (e, handle) => {
    if (!currentRef.current || currentRef.current.mode !== "free") return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    boxDrag.current = { handle, id: e.pointerId, x0: e.clientX, y0: e.clientY, start: currentRef.current };
    setDragging(true);
  };
  const moveBoxDrag = (e) => {
    const d = boxDrag.current;
    const { w, h } = frameSizeRef.current;
    if (!d || d.id !== e.pointerId || !w || !h) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    commit(d.handle === "move" ? moveFreeBox(d.start, dx, dy, w, h) : resizeFreeBox(d.start, d.handle, dx, dy, w, h, { free: e.shiftKey }));
  };
  const endBoxDrag = (e) => {
    if (boxDrag.current?.id !== e.pointerId) return;
    boxDrag.current = null;
    setDragging(false);
  };

  const onHandleKeyDown = (e, handle) => {
    const dir = KEY_DELTAS[e.key];
    if (!dir || !currentRef.current) return;
    const { w, h } = frameSizeRef.current;
    if (!w || !h) return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 0.05 : 0.01) * Math.max(w, h);
    // A key only acts if this handle owns an edge on that axis.
    const ownsX = handle.includes("w") || handle.includes("e");
    const ownsY = handle.includes("n") || handle.includes("s");
    const dx = ownsX ? dir[0] * step : 0;
    const dy = ownsY ? dir[1] * step : 0;
    if (dx || dy) commit(resizeFreeBox(currentRef.current, handle, dx, dy, w, h, { free: true }));
  };

  const onPointerDown = (e) => {
    if (current?.mode === "free") {
      startBoxDrag(e, "move");
      return;
    }
    if (!current || current.mode !== "fill") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = null;
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (boxDrag.current) {
      moveBoxDrag(e);
      return;
    }
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !currentRef.current) return;
    const pos = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, pos);
    if (pointers.current.size === 1) {
      applyPan(pos.x - prev.x, pos.y - prev.y);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current && pinch.current > 0) applyZoom(currentRef.current.zoom * (dist / pinch.current));
      pinch.current = dist;
    }
  };
  const onPointerEnd = (e) => {
    if (boxDrag.current) {
      endBoxDrag(e);
      return;
    }
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const onFrameKeyDown = (e) => {
    if (current?.mode === "free") {
      const { w, h } = frameSizeRef.current;
      const dir = KEY_DELTAS[e.key];
      if (dir && w && h) {
        e.preventDefault();
        const step = (e.shiftKey ? 0.05 : 0.01) * Math.max(w, h);
        commit(moveFreeBox(current, dir[0] * step, dir[1] * step, w, h));
      } else if (e.key === "0") {
        e.preventDefault();
        commit(defaultFraming(active, dims));
      }
      return;
    }
    if (!current || current.mode !== "fill") return;
    const { w, h } = frameSizeRef.current;
    const step = (e.shiftKey ? 0.1 : 0.02) * Math.min(w, h);
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      applyPan(...moves[e.key]);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      applyZoom(current.zoom + 0.1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      applyZoom(current.zoom - 0.1);
    } else if (e.key === "0") {
      e.preventDefault();
      commit(defaultFraming(active, dims));
    }
  };

  const check = useMemo(() => (dims && current ? checkResolution(active, current, dims) : null), [dims, current, active]);
  const stretch = useMemo(() => (current ? stretchAmount(active, current) : { factor: 1, direction: "none" }), [current, active]);
  const rec = recommendedSource(active);
  const [aw, ah] = placement.aspect;
  const LevelIcon = check ? LEVEL_STYLE[check.level].Icon : null;

  const save = () => {
    if (!dims) return;
    const framings = {};
    for (const key of placements) {
      if (edits[key]) framings[key] = edits[key];
      else if (persistAll) framings[key] = framingFor(key);
      else if (initialFramings[key]) framings[key] = sanitizeFraming(initialFramings[key]);
    }
    onSave?.({ framings, touched: Object.keys(edits) });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-3 backdrop-blur-[2px] sm:p-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft"
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            Drag the image to reposition, zoom to crop tighter, choose Fit to keep the whole image, or choose Stretch and drag the image&apos;s edges to fill the frame exactly. The frame below is the real shape of the destination.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-3">
            {placements.length > 1 && (
              <div role="tablist" aria-label="Destination" className="flex flex-wrap gap-2">
                {placements.map((key) => (
                  <button
                    key={key}
                    role="tab"
                    type="button"
                    aria-selected={key === active}
                    onClick={() => setActive(key)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium focus-ring",
                      key === active ? "border-ink bg-ink text-canvas" : "border-line hover:bg-wash",
                    )}
                  >
                    {getPlacement(key).label} · {formatAspect(key)}
                  </button>
                ))}
              </div>
            )}

            {measureError ? (
              <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                {measureError}
              </p>
            ) : !dims || !current ? (
              <div className="grid h-48 place-items-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading image" />
              </div>
            ) : (
              <div className="flex justify-center rounded-xl bg-wash p-5">
                {/* The sizing wrapper is NOT clipped, so stretch-mode handles that sit on the frame's border stay fully visible and clickable. */}
                <div
                  className="relative"
                  style={{ aspectRatio: `${aw} / ${ah}`, width: `min(100%, 760px, calc(52vh * ${aw / ah}))` }}
                >
                  <div
                    ref={frameRef}
                    tabIndex={0}
                    role="group"
                    aria-label={`${placement.label} frame, ${aw} by ${ah}. ${
                      current.mode === "fill"
                        ? "Use the arrow keys to move the image, plus and minus to zoom, zero to reset."
                        : current.mode === "free"
                          ? "Use the arrow keys to move the image, zero to reset. Tab to the edge and corner handles to stretch it."
                          : "Fit mode shows the whole image; switch to Fill to reposition."
                    }`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                    onKeyDown={onFrameKeyDown}
                    className={cn(
                      "absolute inset-0 select-none overflow-hidden rounded-md bg-[repeating-conic-gradient(#0000000d_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] outline-none ring-1 ring-ink/30 focus-visible:ring-2 focus-visible:ring-accent",
                      current.mode === "fit" ? "cursor-default" : dragging ? "cursor-grabbing" : "cursor-grab",
                    )}
                    style={{ touchAction: "none" }}
                    data-testid="framing-frame"
                  >
                    <FramedImage
                      src={source.url}
                      framing={current}
                      placement={active}
                      sizes="760px"
                    />
                    {current.mode === "fill" && !dragging && (
                      <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
                        <Move className="h-3 w-3" aria-hidden="true" /> Drag to reposition
                      </span>
                    )}
                  </div>

                  {current.mode === "free" && (
                    <div className="pointer-events-none absolute inset-0" data-testid="stretch-overlay">
                      {/* Where the image really is — it can extend past the frame, where it is cropped. */}
                      <div
                        className="absolute border border-dashed border-accent"
                        style={{
                          left: `${current.bx * 100}%`,
                          top: `${current.by * 100}%`,
                          width: `${current.bw * 100}%`,
                          height: `${current.bh * 100}%`,
                        }}
                        data-testid="stretch-box"
                      />
                      {FREE_HANDLES.map((handle) => {
                        // Handles stay on the visible part of their edge so they can always be reached.
                        const x0 = clamp01(current.bx);
                        const x1 = clamp01(current.bx + current.bw);
                        const y0 = clamp01(current.by);
                        const y1 = clamp01(current.by + current.bh);
                        const left = handle.includes("w") ? x0 : handle.includes("e") ? x1 : (x0 + x1) / 2;
                        const top = handle.includes("n") ? y0 : handle.includes("s") ? y1 : (y0 + y1) / 2;
                        const meta = HANDLE_META[handle];
                        return (
                          <button
                            key={handle}
                            type="button"
                            aria-label={`Stretch ${meta.label}`}
                            data-handle={handle}
                            onPointerDown={(e) => startBoxDrag(e, handle)}
                            onPointerMove={moveBoxDrag}
                            onPointerUp={endBoxDrag}
                            onPointerCancel={endBoxDrag}
                            onKeyDown={(e) => onHandleKeyDown(e, handle)}
                            className="group pointer-events-auto absolute grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center outline-none"
                            style={{ left: `${left * 100}%`, top: `${top * 100}%`, cursor: meta.cursor, touchAction: "none" }}
                          >
                            <span
                              className={cn(
                                "block border-2 border-accent bg-white shadow group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-1",
                                handle.length === 2 ? "h-3.5 w-3.5 rounded-sm" : handle === "n" || handle === "s" ? "h-2.5 w-7 rounded-full" : "h-7 w-2.5 rounded-full",
                              )}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 text-sm">
            <section aria-label="Destination">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Destination</p>
              <p className="mt-1 font-medium">{placement.label}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Frame shape</dt>
                <dd>{formatAspect(active)}</dd>
                <dt className="text-muted-foreground">Recommended file</dt>
                <dd>
                  {rec.recommended.width} × {rec.recommended.height} px
                </dd>
                <dt className="text-muted-foreground">Minimum</dt>
                <dd>
                  {rec.minimum.width} × {rec.minimum.height} px
                </dd>
                <dt className="text-muted-foreground">Your image</dt>
                <dd>{dims ? `${dims.width} × ${dims.height} px` : "…"}</dd>
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{placement.layout}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Recommended pixels are for sharpness on high-density screens — not the size it appears on screen, which is responsive.
              </p>
            </section>

            {check && (
              <p role="status" className={cn("flex items-start gap-2 rounded-lg border border-line p-2.5 text-xs", LEVEL_STYLE[check.level].className)}>
                <LevelIcon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                <span>{check.message}</span>
              </p>
            )}

            {current?.mode === "free" && stretch.factor >= 1.05 && (
              <p role="status" className={cn("flex items-start gap-2 rounded-lg border border-line p-2.5 text-xs", stretch.factor >= 1.4 ? "text-danger" : "text-amber-600")}>
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                <span>
                  {stretch.factor >= 1.4 ? "Strongly stretched" : "Stretched"}: the image is {Math.round((stretch.factor - 1) * 100)}% {stretch.direction === "wide" ? "wider" : "taller"} than its original proportions, so
                  people and objects will look distorted. Drag the edges until it looks natural, or choose Fill or Fit for an undistorted picture.
                </span>
              </p>
            )}

            <fieldset>
              <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Mode</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  ["fill", "Fill (crop)", "Covers the whole frame; no empty space."],
                  ["fit", "Fit", "Shows the entire image; may leave empty space."],
                  ["free", "Stretch", "Drag the edges to resize each side. May distort the picture."],
                ].map(([value, label, help]) => (
                  <label
                    key={value}
                    className={cn(
                      "cursor-pointer rounded-lg border p-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                      current?.mode === value ? "border-ink bg-wash" : "border-line hover:bg-wash",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${titleId}-mode`}
                      value={value}
                      checked={current?.mode === value}
                      disabled={!current}
                      onChange={() => current && commit(setFramingMode(current, value, active, dims))}
                      className="sr-only"
                    />
                    <span className="block text-xs font-semibold">{label}</span>
                    <span className="block text-[11px] text-muted-foreground">{help}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor={`${titleId}-zoom`} className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Zoom{current?.mode === "fill" ? ` · ${current.zoom.toFixed(2)}×` : ""}
              </label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="subtle" size="sm" aria-label="Zoom out" disabled={!current || current.mode !== "fill"} onClick={() => applyZoom((current?.zoom || 1) - 0.1)}>
                  <Minus className="h-4 w-4" />
                </Button>
                <input
                  id={`${titleId}-zoom`}
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={current?.zoom ?? 1}
                  disabled={!current || current.mode !== "fill"}
                  aria-valuetext={`${(current?.zoom ?? 1).toFixed(2)} times`}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  className="min-w-0 flex-1 accent-primary"
                />
                <Button type="button" variant="subtle" size="sm" aria-label="Zoom in" disabled={!current || current.mode !== "fill"} onClick={() => applyZoom((current?.zoom || 1) + 0.1)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {current?.mode === "fit" && <p className="mt-1 text-[11px] text-muted-foreground">Fit always shows the whole image, so zoom and drag are off.</p>}
              {current?.mode === "free" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stretch is sized by dragging: an edge handle stretches that side only, a corner handle resizes proportionally (hold Shift to move a corner freely). Drag the picture to move it.
                </p>
              )}
            </div>

            <Button type="button" variant="subtle" size="sm" disabled={!dims} onClick={() => commit(defaultFraming(active, dims))}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mx-5 mb-2 rounded-lg bg-danger/10 p-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={saving} disabled={!dims || !!measureError}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
