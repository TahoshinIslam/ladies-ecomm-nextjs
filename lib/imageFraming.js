// Shared image-framing rules: ONE module imported by the admin framing
// editor, the storefront renderer (components/ui/FramedImage.jsx), the API
// schemas, and the tests — so "what the editor shows" and "what the
// storefront renders" cannot drift apart. Pure functions only (no React, no
// DOM), safe in server and client code alike.
//
// Model. A saved framing is `{ v, mode, zoom, x, y, w, h }`:
//   mode  "fill" — cover the frame completely (crop), or
//         "fit"  — show the whole image inside the frame (letterbox).
//   zoom  >= 1, fill mode only (fit always shows the whole image).
//   x, y  0..1 — where the image sits inside the space it overflows the
//         frame by (fill) or the letterbox space around it (fit). 0 = left/
//         top edges aligned, 1 = right/bottom, .5 = centred. Same meaning as
//         CSS object-position percentages, so a legacy `object-top` is y = 0.
//   w, h  the image's natural pixel size when it was framed (its ASPECT is
//         what the geometry needs; the pixel size drives the resolution check).
// The ORIGINAL image is never modified — a framing is metadata only, so
// clearing it restores the untouched original.

export const FRAMING_VERSION = 1;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
// "free" mode (drag the image's edges): the image is an absolutely-positioned
// box measured in FRACTIONS of the frame (bx/by = top-left, bw/bh = size), so
// it scales with the frame at any screen size. At least MIN_BOX of the frame
// must stay covered on each axis and a side may not exceed MAX_BOX frames —
// together these keep every edge handle reachable and the image on screen.
export const MIN_BOX = 0.1;
export const MAX_BOX = 6;
// Recommended source = frame's widest CSS size x this many device pixels
// (2 = retina). Below 1x the image is upscaled on ordinary screens.
export const RECOMMENDED_DPR = 2;
// Uploads are capped at 5 MB (services/uploadService.js), so recommending a
// multi-thousand-pixel edge would only invite rejected files.
export const MAX_RECOMMENDED_EDGE = 2560;

// Every place an uploaded image is displayed. Numbers come from the actual
// layout code — see `layout` for where each one is defined. `maxCssWidth` is
// the widest the frame ever gets in CSS px (NOT the recommended file size:
// see recommendedSource()). `legacy` is how that spot renders TODAY when no
// framing has been saved, so untouched images keep rendering unchanged.
export const PLACEMENTS = {
  "hero.desktop": {
    label: "Homepage hero — desktop",
    aspect: [16, 7],
    maxCssWidth: 1400,
    defaultMode: "fill",
    defaultPos: [0.5, 0.5],
    legacy: { fit: "contain", position: "center top" },
    layout:
      "Shown from 640px wide upward, full content width (views/HomePage.jsx). Exactly 16:7 between about 1000 and 1300px screens; the height stops growing at 560px, so on wider screens it becomes up to 1400×560 (2.5:1), and on tablets (640–900px) a 360px minimum height makes it about 2:1. Fill always covers whatever shape it gets — keep key subjects away from the top and bottom edges.",
  },
  "hero.mobile": {
    label: "Homepage hero — mobile",
    aspect: [1, 1],
    maxCssWidth: 400,
    sourceAspect: [4, 3],
    sourceCssWidth: 600,
    defaultMode: "fill",
    defaultPos: [0.5, 0.5],
    legacy: { fit: "contain", position: "center top" },
    layout:
      "Shown below 640px wide, full width. The layout says 4:3, but HeroCarousel's 360px minimum height wins on phones, so 320–430px phones actually show about 1:1 (0.9–1.1:1); from ~512px wide it becomes 4:3 (up to 607×455). The 4:3 recommended file covers both shapes.",
  },
  "popup.desktop": {
    label: "Campaign popup — desktop",
    aspect: [3, 1],
    maxCssWidth: 896,
    defaultMode: "fill",
    defaultPos: [0.5, 0.5],
    legacy: { fit: "cover", position: "center center" },
    layout:
      "Shown from 640px wide upward. The modal is up to 896px wide and the image band is 32% of the window height clamped to 180–340px (components/layout/CampaignPopup.jsx), so its shape follows the window: about 2.6:1 on tall screens to 3.9:1 on short ones (3.1:1 at 1440×900).",
  },
  "popup.mobile": {
    label: "Campaign popup — mobile",
    aspect: [4, 3],
    maxCssWidth: 600,
    defaultMode: "fill",
    defaultPos: [0.5, 0.5],
    legacy: { fit: "cover", position: "center center" },
    layout:
      "Shown below 640px wide: the modal's full width, with the same 32%-of-window-height band (180–340px), so about 1.3:1 on a 390×844 phone and up to 1.6:1 on shorter screens.",
  },
  "department.tile": {
    label: "Department — square tile",
    aspect: [1, 1],
    maxCssWidth: 170,
    defaultMode: "fill",
    defaultPos: [0.5, 0],
    legacy: { fit: "cover", position: "center top" },
    layout:
      "The small square tile in the homepage 'favourites' row and the Shop page's category row (components/product/CategoryCard.jsx): always square, only about 103–165px wide.",
  },
  "department.card": {
    label: "Department — homepage card",
    aspect: [4, 3],
    maxCssWidth: 400,
    defaultMode: "fill",
    defaultPos: [0.5, 0],
    legacy: { fit: "cover", position: "center top" },
    layout: "The 4:3 picture in the homepage 'Shop by department' cards (views/HomePage.jsx): always 4:3, about 175–395px wide.",
  },
  "fabric.tile": {
    label: "Fabric card",
    aspect: [6, 5],
    maxCssWidth: 600,
    defaultMode: "fill",
    defaultPos: [0.5, 0],
    legacy: { fit: "cover", position: "center top" },
    layout:
      "Homepage fabric cards: a fixed 220px tall and 177–358px wide (up to ~600px on a single-column phone), so the shape swings from tall to wide (0.8:1 to 2.7:1) — about 1.2:1 on desktop, shown here. The focal point you set decides what survives the crop.",
  },
  "occasion.tile": {
    label: "Occasion card",
    aspect: [8, 5],
    maxCssWidth: 600,
    defaultMode: "fill",
    defaultPos: [0.5, 0],
    legacy: { fit: "cover", position: "center top" },
    layout:
      "Homepage occasion cards: a fixed 200px tall and 226–358px wide (up to ~600px on a single-column phone) — about 1.6:1 on desktop, shown here; the shape varies with the screen.",
  },
  "guided.panel": {
    label: "Guided Discovery photo",
    aspect: [3, 2],
    maxCssWidth: 960,
    defaultMode: "fill",
    defaultPos: [0.5, 0],
    legacy: { fit: "cover", position: "center top" },
    layout:
      "The image panel of the Guided Discovery section (views/home/GuidedFinderSection.jsx): about 650×435 (1.5:1) beside the text on desktop; full width (up to ~960px, 2–3:1) when stacked below 1024px. Shape varies with the screen; 3:2 shown.",
  },
  "banner.home": {
    label: "Homepage promo banner",
    aspect: [10, 3],
    maxCssWidth: 1400,
    defaultMode: "fill",
    defaultPos: [0.5, 0.5],
    legacy: { natural: true },
    layout:
      "Full content width (up to 1400px) below the featured products. Today the banner takes the uploaded image's own proportions; once framed it uses a fixed 10:3 box.",
  },
  "product.gallery": {
    label: "Product photo (card and detail page)",
    aspect: [4, 5],
    maxCssWidth: 684,
    defaultMode: "fit",
    defaultPos: [0.5, 0.5],
    legacy: { fit: "contain", position: "center center" },
    layout:
      "The product card and the detail-page gallery share one 4:5 plate (components/product/ProductCard.jsx, views/product/ProductDetailInteractive.jsx). Products default to Fit so the whole item shows; the detail page's plate is up to ~684px wide.",
  },
};

export function getPlacement(key) {
  const placement = PLACEMENTS[key];
  if (!placement) throw new Error(`Unknown image placement "${key}"`);
  return placement;
}

export const aspectRatio = (key) => {
  const [w, h] = getPlacement(key).aspect;
  return w / h;
};

export const formatAspect = (key) => getPlacement(key).aspect.join(":");

/**
 * Recommended (retina-sharp) and minimum (1x) SOURCE pixel sizes for a
 * placement, derived from its frame's widest CSS size. Deliberately separate
 * from the responsive display size: `maxCssWidth` is how big the frame gets
 * on screen, these are how many pixels the file should contain.
 */
export function recommendedSource(key) {
  const p = getPlacement(key);
  // Some frames change shape with the screen (e.g. the phone hero); their file
  // recommendation can use a shape/width that covers every variant.
  const [aw, ah] = p.sourceAspect || p.aspect;
  const cssWidth = p.sourceCssWidth || p.maxCssWidth;
  const scaleTo = (w) => ({ width: Math.round(w), height: Math.round((w * ah) / aw) });
  let rec = scaleTo(cssWidth * RECOMMENDED_DPR);
  const longEdge = Math.max(rec.width, rec.height);
  if (longEdge > MAX_RECOMMENDED_EDGE) {
    rec = scaleTo((cssWidth * RECOMMENDED_DPR * MAX_RECOMMENDED_EDGE) / longEdge);
  }
  return { recommended: rec, minimum: scaleTo(cssWidth) };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round4 = (n) => Math.round(n * 10000) / 10000;

export function defaultFraming(key, dims) {
  const p = getPlacement(key);
  return {
    v: FRAMING_VERSION,
    mode: p.defaultMode,
    zoom: 1,
    x: p.defaultPos[0],
    y: p.defaultPos[1],
    w: Math.round(dims.width),
    h: Math.round(dims.height),
  };
}

/** Validates/clamps a framing from any source (DB, request, editor). null when unusable. */
export function sanitizeFraming(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = raw.mode === "fit" ? "fit" : raw.mode === "fill" ? "fill" : raw.mode === "free" ? "free" : null;
  const w = Math.round(Number(raw.w));
  const h = Math.round(Number(raw.h));
  const x = Number(raw.x);
  const y = Number(raw.y);
  const zoom = Number(raw.zoom);
  if (!mode || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  if (!(w > 0 && h > 0) || w > 50000 || h > 50000) return null;
  const out = {
    v: FRAMING_VERSION,
    mode,
    // Fit always shows the whole image, and free sizes it by its box.
    zoom: mode === "fill" ? round4(clamp(zoom, MIN_ZOOM, MAX_ZOOM)) : 1,
    x: round4(clamp(x, 0, 1)),
    y: round4(clamp(y, 0, 1)),
    w,
    h,
  };
  if (mode === "free") {
    const box = sanitizeBox(raw);
    if (!box) return null;
    Object.assign(out, box);
  }
  return out;
}

/** The free-mode box of a framing, clamped so the image always stays reachable; null when missing/invalid. */
function sanitizeBox(raw) {
  const [bx, by, bw, bh] = [raw.bx, raw.by, raw.bw, raw.bh].map(Number);
  if (![bx, by, bw, bh].every(Number.isFinite)) return null;
  const width = clamp(bw, MIN_BOX, MAX_BOX);
  const height = clamp(bh, MIN_BOX, MAX_BOX);
  return {
    bx: round4(clamp(bx, MIN_BOX - width, 1 - MIN_BOX)),
    by: round4(clamp(by, MIN_BOX - height, 1 - MIN_BOX)),
    bw: round4(width),
    bh: round4(height),
  };
}

/** DB JSON columns come back as a string or an already-parsed value depending on server/driver. */
export function parseFramingColumn(value) {
  if (value == null || value === "") return null;
  try {
    return sanitizeFraming(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}

/**
 * Per-photo framings are a LIST of { url, framing } entries, never an object
 * keyed by URL: request bodies pass through lib/validation.js's
 * assertNoOperatorInjection(), which (deliberately) rejects any object KEY
 * containing "." — and every URL has dots. Values are unrestricted.
 */
export function parseFramingListColumn(value) {
  if (value == null || value === "") return [];
  let raw = value;
  try {
    if (typeof value === "string") raw = JSON.parse(value);
  } catch {
    return [];
  }
  return normalizeFramingList(raw);
}

/** Keeps only well-formed { url, framing } entries (one per url, first wins). Never throws. */
export function normalizeFramingList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const url = typeof entry?.url === "string" ? entry.url : "";
    const framing = sanitizeFraming(entry?.framing);
    if (!url || !framing || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, framing });
  }
  return out;
}

export function framingForUrl(list, url) {
  if (!Array.isArray(list) || !url) return null;
  return sanitizeFraming(list.find((e) => e?.url === url)?.framing);
}

/** Returns a new list with `url`'s framing set (or removed when `framing` is null). */
export function setFramingForUrl(list, url, framing) {
  const rest = normalizeFramingList(list).filter((e) => e.url !== url);
  const f = sanitizeFraming(framing);
  return f ? [...rest, { url, framing: f }] : rest;
}

/** Drops entries for photos that are no longer used. */
export function pruneFramingList(list, usedUrls) {
  const used = usedUrls instanceof Set ? usedUrls : new Set(usedUrls);
  return normalizeFramingList(list).filter((e) => used.has(e.url));
}

/**
 * The single source of truth for how a framed image is placed. Returns CSS
 * for an absolutely-positioned <img> inside a `container-type: size` box —
 * cq units make the maths use the frame's ACTUAL rendered size, so Fill
 * covers the frame exactly at any real shape (not just the nominal one) and
 * the editor preview and storefront run this same function.
 */
export function framedImageStyle(framing) {
  const f = sanitizeFraming(framing);
  if (!f) return null;
  if (f.mode === "free") {
    // Percentages of the caller's frame (the absolute-positioned wrapper), so
    // the stretched image tracks the frame's real shape at any size.
    return {
      position: "absolute",
      maxWidth: "none",
      objectFit: "fill",
      left: `${round4(f.bx * 100)}%`,
      top: `${round4(f.by * 100)}%`,
      width: `${round4(f.bw * 100)}%`,
      height: `${round4(f.bh * 100)}%`,
    };
  }
  const r = round4(f.w / f.h);
  const base = f.mode === "fill" ? `max(100cqw, 100cqh * ${r})` : `min(100cqw, 100cqh * ${r})`;
  const width = f.mode === "fill" && f.zoom !== 1 ? `calc((${base}) * ${f.zoom})` : `calc(${base})`;
  return {
    position: "absolute",
    maxWidth: "none",
    height: "auto",
    aspectRatio: String(r),
    "--fr-w": width,
    width: "var(--fr-w)",
    left: `calc((100cqw - var(--fr-w)) * ${f.x})`,
    top: `calc((100cqh - var(--fr-w) / ${r}) * ${f.y})`,
  };
}

/** Pixel maths for the editor (same rules as framedImageStyle, in px). */
export function framedImageRect(framing, frameW, frameH) {
  const f = sanitizeFraming(framing);
  if (!f || !(frameW > 0) || !(frameH > 0)) return null;
  if (f.mode === "free") {
    const width = f.bw * frameW;
    const height = f.bh * frameH;
    return { width, height, left: f.bx * frameW, top: f.by * frameH, overflowX: Math.max(0, width - frameW), overflowY: Math.max(0, height - frameH) };
  }
  const r = f.w / f.h;
  const coverW = Math.max(frameW, frameH * r);
  const containW = Math.min(frameW, frameH * r);
  const width = f.mode === "fill" ? coverW * f.zoom : containW;
  const height = width / r;
  return {
    width,
    height,
    left: (frameW - width) * f.x,
    top: (frameH - height) * f.y,
    overflowX: Math.max(0, width - frameW),
    overflowY: Math.max(0, height - frameH),
  };
}

/** Moves the focal point by a pointer drag of (dx, dy) screen px in a frameW x frameH frame. */
export function panFraming(framing, dx, dy, frameW, frameH) {
  const f = sanitizeFraming(framing);
  const rect = f && framedImageRect(f, frameW, frameH);
  if (!f || !rect || f.mode !== "fill") return f;
  return sanitizeFraming({
    ...f,
    // Dragging the image right (dx > 0) reveals more of its LEFT side -> x decreases.
    x: rect.overflowX > 0 ? f.x - dx / rect.overflowX : f.x,
    y: rect.overflowY > 0 ? f.y - dy / rect.overflowY : f.y,
  });
}

/** Changes zoom while keeping whatever is at the frame centre fixed as far as the clamps allow. */
export function zoomFraming(framing, nextZoom, frameW, frameH) {
  const f = sanitizeFraming(framing);
  if (!f || f.mode !== "fill") return f;
  const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const before = framedImageRect(f, frameW, frameH);
  const centreU = (frameW / 2 - before.left) / before.width;
  const centreV = (frameH / 2 - before.top) / before.height;
  const after = framedImageRect({ ...f, zoom: z }, frameW, frameH);
  const x = after.overflowX > 0 ? (frameW / 2 - centreU * after.width) / (frameW - after.width) : f.x;
  const y = after.overflowY > 0 ? (frameH / 2 - centreV * after.height) / (frameH - after.height) : f.y;
  return sanitizeFraming({ ...f, zoom: z, x, y });
}

export function setFramingMode(framing, mode, key, dims) {
  const base = sanitizeFraming(framing) || defaultFraming(key, dims);
  if (mode === "fit") return sanitizeFraming({ ...base, mode: "fit", zoom: 1, x: 0.5, y: 0.5 });
  // Stretch starts as "exactly fills the frame" (the whole image, no crop, no
  // empty space) — the admin then drags the edges from there.
  if (mode === "free") return sanitizeFraming({ ...base, mode: "free", zoom: 1, x: 0.5, y: 0.5, bx: 0, by: 0, bw: 1, bh: 1 });
  const p = getPlacement(key);
  return sanitizeFraming({ ...base, mode: "fill", zoom: 1, x: p.defaultPos[0], y: p.defaultPos[1] });
}

const HANDLE_EDGES = {
  n: { top: true },
  s: { bottom: true },
  w: { left: true },
  e: { right: true },
  nw: { top: true, left: true },
  ne: { top: true, right: true },
  sw: { bottom: true, left: true },
  se: { bottom: true, right: true },
};
export const FREE_HANDLES = Object.keys(HANDLE_EDGES);

/**
 * Drag one handle of the free box by (dx, dy) screen px in a frameW x frameH
 * frame. Edge handles (n/s/e/w) stretch that one side — the opposite side stays
 * put, so the image is deliberately non-proportional. Corner handles keep the
 * box's current proportions (hold Shift → `free: true` to stretch both sides
 * independently). The box can be pulled past the frame (it is then cropped) or
 * pushed inside it (leaving empty frame).
 */
export function resizeFreeBox(framing, handle, dx, dy, frameW, frameH, { free = false } = {}) {
  const f = sanitizeFraming(framing);
  const edges = HANDLE_EDGES[handle];
  if (!f || f.mode !== "free" || !edges || !(frameW > 0) || !(frameH > 0)) return f;
  let left = f.bx * frameW;
  let top = f.by * frameH;
  let right = left + f.bw * frameW;
  let bottom = top + f.bh * frameH;
  const minW = MIN_BOX * frameW;
  const minH = MIN_BOX * frameH;
  const w0 = right - left;
  const h0 = bottom - top;
  const corner = (edges.left || edges.right) && (edges.top || edges.bottom);

  if (corner && !free) {
    // Uniform scale about the opposite corner, driven by whichever axis moved more (relatively).
    const sx = (w0 + (edges.right ? dx : -dx)) / w0;
    const sy = (h0 + (edges.bottom ? dy : -dy)) / h0;
    const s = Math.max(minW / w0, minH / h0, Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy);
    const nw = w0 * s;
    const nh = h0 * s;
    if (edges.left) left = right - nw;
    else right = left + nw;
    if (edges.top) top = bottom - nh;
    else bottom = top + nh;
  } else {
    if (edges.left) left = Math.min(left + dx, right - minW);
    if (edges.right) right = Math.max(right + dx, left + minW);
    if (edges.top) top = Math.min(top + dy, bottom - minH);
    if (edges.bottom) bottom = Math.max(bottom + dy, top + minH);
  }
  return sanitizeFraming({ ...f, bx: left / frameW, by: top / frameH, bw: (right - left) / frameW, bh: (bottom - top) / frameH });
}

/** Moves the whole free box by a drag of (dx, dy) screen px. */
export function moveFreeBox(framing, dx, dy, frameW, frameH) {
  const f = sanitizeFraming(framing);
  if (!f || f.mode !== "free" || !(frameW > 0) || !(frameH > 0)) return f;
  return sanitizeFraming({ ...f, bx: f.bx + dx / frameW, by: f.by + dy / frameH });
}

/**
 * How much a free-mode image is stretched away from its own proportions in a
 * frame of the placement's shape: 1 = undistorted, 1.5 = 50% wider (or, when
 * `direction` is "tall", taller) than it should be. Fill/Fit never distort.
 */
export function stretchAmount(key, framing) {
  const f = sanitizeFraming(framing);
  if (!f || f.mode !== "free") return { factor: 1, direction: "none" };
  const frameAspect = aspectRatio(key);
  const shown = (f.bw * frameAspect) / f.bh; // displayed width / height of the image
  const natural = f.w / f.h;
  const ratio = shown / natural;
  return { factor: Math.round((ratio >= 1 ? ratio : 1 / ratio) * 1000) / 1000, direction: ratio > 1.0005 ? "wide" : ratio < 0.9995 ? "tall" : "none" };
}

/**
 * How many SOURCE pixels the visible crop actually spans versus what the
 * placement needs. `level`: ok (>= recommended), low (>= minimum but soft on
 * high-density screens), insufficient (below 1x — will look blurry).
 */
export function checkResolution(key, framing, dims) {
  const p = getPlacement(key);
  const f = sanitizeFraming(framing) || defaultFraming(key, dims);
  const iw = dims.width;
  const ih = dims.height;
  const frameAspect = p.aspect[0] / p.aspect[1];
  const imgAspect = iw / ih;
  let visibleW;
  let neededCssW;
  if (f.mode === "free") {
    // The image spans bw frames; only its overlap with the frame is on screen.
    const overlap = Math.max(0, Math.min(f.bx + f.bw, 1) - Math.max(f.bx, 0));
    visibleW = (iw * overlap) / f.bw;
    neededCssW = overlap * p.maxCssWidth;
  } else if (f.mode === "fit") {
    // Whole image shown; it fills the frame width (wide image) or a share of it (tall image).
    visibleW = iw;
    neededCssW = imgAspect >= frameAspect ? p.maxCssWidth : p.maxCssWidth * (imgAspect / frameAspect);
  } else {
    // Cover: the source region across the frame width, shrunk further by zoom.
    const coverRegionW = imgAspect > frameAspect ? ih * frameAspect : iw;
    visibleW = coverRegionW / f.zoom;
    neededCssW = p.maxCssWidth;
  }
  const minimum = Math.min(Math.round(neededCssW), MAX_RECOMMENDED_EDGE);
  // The recommendation is capped (uploads are limited to 5 MB), so a file at
  // the recommended size must read as sharp.
  const recommended = Math.min(Math.round(neededCssW * RECOMMENDED_DPR), MAX_RECOMMENDED_EDGE);
  const level = visibleW >= recommended ? "ok" : visibleW >= minimum ? "low" : "insufficient";
  const message =
    level === "ok"
      ? "Resolution is sharp for this placement."
      : level === "low"
        ? `The visible crop is ${Math.round(visibleW)}px wide — fine on standard screens, slightly soft on high-density ones (${recommended}px recommended).`
        : `The visible crop is only ${Math.round(visibleW)}px wide but this placement shows it up to ${minimum}px wide, so it will look blurry. Use a larger image or zoom out.`;
  return { level, visibleWidth: Math.round(visibleW), recommendedWidth: recommended, minimumWidth: minimum, message };
}

/**
 * Framing for a device slot when only some crops were supplied: its own crop
 * if present; otherwise the OTHER slot's crop carried over (mode, zoom and
 * focal point — Fill re-covers the new frame shape) but ONLY when both slots
 * show the same image, because a crop records that image's proportions and
 * can't be applied to a different file; otherwise null = render as before.
 */
export function resolveSlotFraming({ own, ownSrc, other, otherSrc }) {
  const f = sanitizeFraming(own);
  if (f) return f;
  return ownSrc && ownSrc === otherSrc ? sanitizeFraming(other) : null;
}

/**
 * Key of a homepage slot in settings.homepage.imageFraming: "<placement>" or
 * "<placement>:<slug>" with the placement's "." written as "_" (the request-
 * body guard rejects keys containing "."), e.g. "department_tile:burqa".
 */
export const homepageFramingKey = (placement, slug) => `${placement.replace(".", "_")}${slug ? `:${slug}` : ""}`;

/** Saved framing for a homepage image slot (settings.homepage.imageFraming), or null = unframed. */
export function homepageFramingFor(map, placement, slug) {
  return sanitizeFraming(map?.[homepageFramingKey(placement, slug)]);
}

/** Scales every size in a `sizes` attribute ("(max-width: 640px) 100vw, 50vw") by `factor`. */
export function scaleSizes(sizes, factor) {
  if (!sizes || factor === 1) return sizes;
  return sizes
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const m = trimmed.match(/^(\(.*\))?\s*(\S+)$/);
      if (!m) return trimmed;
      const [, cond, size] = m;
      return `${cond ? `${cond} ` : ""}calc(${size} * ${round4(factor)})`;
    })
    .join(", ");
}

/** Multiplier from frame width to rendered image width (>= 1 when it fills; <= 1 for a tall image in Fit). */
export function widthFactor(framing, key) {
  const f = sanitizeFraming(framing);
  if (!f) return 1;
  if (f.mode === "free") return Math.max(f.bw, MIN_BOX);
  const frameAspect = aspectRatio(key);
  const imgAspect = f.w / f.h;
  return f.mode === "fill"
    ? (imgAspect > frameAspect ? imgAspect / frameAspect : 1) * f.zoom
    : imgAspect >= frameAspect
      ? 1
      : imgAspect / frameAspect;
}
