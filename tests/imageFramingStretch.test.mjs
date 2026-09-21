// "Stretch" (mode "free") — the admin drags an image's edges/corners to resize
// each side independently. Pins: the stored shape, the drag maths behind every
// handle, that the box always stays reachable, the renderer's output, the
// distortion measure, the API schema, and that Fill/Fit are untouched.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  FREE_HANDLES,
  MAX_BOX,
  MIN_BOX,
  checkResolution,
  defaultFraming,
  framedImageRect,
  framedImageStyle,
  moveFreeBox,
  resizeFreeBox,
  sanitizeFraming,
  setFramingMode,
  stretchAmount,
  widthFactor,
} from "../lib/imageFraming.js";
import { framingSchema, homepageFramingMapSchema } from "../schemas/framingSchema.js";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url).pathname, "utf8");
const DIMS = { width: 1200, height: 1600 };
const FW = 700;
const FH = 306; // a 16:7 hero frame in px
const free = (over = {}) => ({ v: 1, mode: "free", zoom: 1, x: 0.5, y: 0.5, w: 1200, h: 1600, bx: 0, by: 0, bw: 1, bh: 1, ...over });
const edges = (f) => ({ l: f.bx * FW, t: f.by * FH, r: (f.bx + f.bw) * FW, b: (f.by + f.bh) * FH });
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

describe("stored shape", () => {
  test("Stretch starts as exactly filling the frame — whole image, no crop, no gap", () => {
    const f = setFramingMode(defaultFraming("hero.desktop", DIMS), "free", "hero.desktop", DIMS);
    assert.deepEqual(f, free());
  });

  test("a free framing must carry a valid box; Fill and Fit never carry one", () => {
    assert.equal(sanitizeFraming({ ...free(), bx: undefined }), null);
    assert.equal(sanitizeFraming({ ...free(), bw: "wide" }), null);
    const fill = sanitizeFraming({ v: 1, mode: "fill", zoom: 1.5, x: 0.4, y: 0.6, w: 1000, h: 800, bx: 0.2, by: 0.2, bw: 2, bh: 2 });
    assert.deepEqual(fill, { v: 1, mode: "fill", zoom: 1.5, x: 0.4, y: 0.6, w: 1000, h: 800 }, "stray box fields are dropped");
    const fit = sanitizeFraming({ v: 1, mode: "fit", zoom: 3, x: 0.5, y: 0.5, w: 1000, h: 800, bx: 0, by: 0, bw: 1, bh: 1 });
    assert.equal("bx" in fit, false);
  });

  test("the box is clamped so the image can never be lost: >= MIN_BOX stays on-screen and no side exceeds MAX_BOX", () => {
    const tiny = sanitizeFraming(free({ bw: 0.001, bh: 0.001 }));
    assert.equal(tiny.bw, MIN_BOX);
    assert.equal(tiny.bh, MIN_BOX);
    const huge = sanitizeFraming(free({ bw: 99, bh: 99 }));
    assert.equal(huge.bw, MAX_BOX);
    const gone = sanitizeFraming(free({ bx: 50, by: -50 }));
    assert.ok(gone.bx <= 1 - MIN_BOX + 1e-9, "left edge can't leave the frame's right side");
    assert.ok(gone.by + gone.bh >= MIN_BOX - 1e-9, "bottom edge can't leave the frame's top");
  });
});

describe("edge handles stretch ONE side; the opposite side never moves", () => {
  const start = free({ bx: 0.1, by: 0.2, bw: 0.6, bh: 0.5 });
  const cases = [
    ["e", 70, 0, (a, b) => near(b.l, a.l) && near(b.t, a.t) && near(b.b, a.b) && near(b.r, a.r + 70)],
    ["w", -50, 0, (a, b) => near(b.r, a.r) && near(b.t, a.t) && near(b.b, a.b) && near(b.l, a.l - 50)],
    ["s", 0, 30, (a, b) => near(b.l, a.l) && near(b.r, a.r) && near(b.t, a.t) && near(b.b, a.b + 30)],
    ["n", 0, -20, (a, b) => near(b.l, a.l) && near(b.r, a.r) && near(b.b, a.b) && near(b.t, a.t - 20)],
  ];
  for (const [handle, dx, dy, check] of cases) {
    test(`${handle}: only that edge moves`, () => {
      const out = resizeFreeBox(start, handle, dx, dy, FW, FH);
      assert.ok(check(edges(start), edges(out)), JSON.stringify({ handle, before: edges(start), after: edges(out) }));
    });
  }

  test("a horizontal drag on a horizontal-edge handle (and vice versa) does nothing", () => {
    assert.deepEqual(resizeFreeBox(start, "n", 200, 0, FW, FH), start);
    assert.deepEqual(resizeFreeBox(start, "e", 0, 200, FW, FH), start);
  });

  test("stretching really changes the proportions (that is the point of this mode)", () => {
    const out = resizeFreeBox(free(), "e", -350, 0, FW, FH); // squeeze width to half
    assert.equal(out.bw, 0.5);
    assert.equal(out.bh, 1);
    assert.ok(stretchAmount("hero.desktop", out).factor > 1);
  });

  test("an edge cannot cross its opposite edge — it stops at the minimum size", () => {
    const out = resizeFreeBox(start, "e", -10_000, 0, FW, FH);
    assert.ok(near(out.bw, MIN_BOX, 1e-3));
    assert.ok(near(out.bx, start.bx, 1e-3), "the left edge stayed put");
  });

  test("dragging an edge out past the frame is allowed (the image is then cropped) and inside it leaves empty frame", () => {
    assert.ok(resizeFreeBox(free(), "e", 200, 0, FW, FH).bw > 1);
    assert.ok(resizeFreeBox(free(), "w", 200, 0, FW, FH).bx > 0);
  });
});

describe("corner handles", () => {
  const start = free({ bx: 0.1, by: 0.1, bw: 0.6, bh: 0.5 });
  const pixelAspect = (f) => (f.bw * FW) / (f.bh * FH);

  test("keep the box's current proportions and stay anchored at the opposite corner", () => {
    for (const handle of ["nw", "ne", "sw", "se"]) {
      const out = resizeFreeBox(start, handle, 40, 25, FW, FH);
      assert.ok(near(pixelAspect(out), pixelAspect(start), 1e-3), `${handle} changed proportions`);
      const a = edges(start);
      const b = edges(out);
      if (handle.includes("n")) assert.ok(near(b.b, a.b), `${handle}: bottom stays`);
      else assert.ok(near(b.t, a.t), `${handle}: top stays`);
      if (handle.includes("w")) assert.ok(near(b.r, a.r), `${handle}: right stays`);
      else assert.ok(near(b.l, a.l), `${handle}: left stays`);
    }
  });

  test("with `free` (Shift) a corner stretches both sides independently", () => {
    const out = resizeFreeBox(start, "se", 100, -30, FW, FH, { free: true });
    assert.ok(near(edges(out).r, edges(start).r + 100));
    assert.ok(near(edges(out).b, edges(start).b - 30));
    assert.ok(!near(pixelAspect(out), pixelAspect(start), 1e-3));
  });
});

describe("property: any sequence of drags keeps a valid, reachable box", () => {
  test("random drags on every handle (with and without Shift) never produce an invalid framing", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let run = 0; run < 400; run++) {
      let f = free();
      for (let step = 0; step < 8; step++) {
        const handle = FREE_HANDLES[Math.floor(rnd() * FREE_HANDLES.length)];
        f = resizeFreeBox(f, handle, (rnd() - 0.5) * 1600, (rnd() - 0.5) * 800, FW, FH, { free: rnd() > 0.5 });
        f = moveFreeBox(f, (rnd() - 0.5) * 1200, (rnd() - 0.5) * 600, FW, FH);
        assert.ok(f, "never null");
        assert.equal(f.mode, "free");
        for (const n of [f.bx, f.by, f.bw, f.bh]) assert.ok(Number.isFinite(n));
        assert.ok(f.bw >= MIN_BOX - 1e-9 && f.bw <= MAX_BOX + 1e-9);
        assert.ok(f.bh >= MIN_BOX - 1e-9 && f.bh <= MAX_BOX + 1e-9);
        assert.ok(f.bx + f.bw >= MIN_BOX - 1e-3 && f.bx <= 1 - MIN_BOX + 1e-3, "still overlaps the frame horizontally");
        assert.ok(f.by + f.bh >= MIN_BOX - 1e-3 && f.by <= 1 - MIN_BOX + 1e-3, "still overlaps the frame vertically");
        assert.deepEqual(sanitizeFraming(f), f, "already canonical");
      }
    }
  });
});

describe("moving", () => {
  test("moveFreeBox shifts the whole box and keeps its size", () => {
    const f = free({ bx: 0.1, by: 0.1, bw: 0.5, bh: 0.5 });
    const m = moveFreeBox(f, 70, -30.6, FW, FH);
    assert.ok(near(m.bx, 0.2, 1e-3) && near(m.by, 0, 1e-3));
    assert.equal(m.bw, 0.5);
    assert.equal(m.bh, 0.5);
  });
});

describe("rendering: the storefront and the editor share one function", () => {
  test("free mode positions the image with frame-relative percentages and stretches it to that box", () => {
    const css = framedImageStyle(free({ bx: 0.1, by: -0.2, bw: 0.75, bh: 1.4 }));
    assert.equal(css.left, "10%");
    assert.equal(css.top, "-20%");
    assert.equal(css.width, "75%");
    assert.equal(css.height, "140%");
    assert.equal(css.objectFit, "fill");
    assert.equal(css.position, "absolute");
  });

  test("Fill and Fit output is unchanged by this feature (same keys, container-query maths)", () => {
    const fill = framedImageStyle({ mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 2400, h: 1000 });
    assert.match(fill["--fr-w"], /max\(100cqw, 100cqh \* 2\.4\)/);
    assert.equal(fill.objectFit, undefined);
    assert.equal(fill.height, "auto");
  });

  test("framedImageRect (editor maths) agrees with the CSS: left/top/width/height are the box times the frame", () => {
    const r = framedImageRect(free({ bx: 0.1, by: -0.2, bw: 0.75, bh: 1.4 }), 800, 350);
    assert.deepEqual([r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100), [80, -70, 600, 490]);
  });

  test("the `sizes` hint follows the box width", () => {
    assert.equal(widthFactor(free({ bw: 0.5 }), "hero.desktop"), 0.5);
    assert.equal(widthFactor(free({ bw: 1.8 }), "hero.desktop"), 1.8);
  });
});

describe("distortion measure", () => {
  test("Fill and Fit never distort", () => {
    assert.deepEqual(stretchAmount("hero.desktop", { mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 1200, h: 1600 }), { factor: 1, direction: "none" });
  });
  test("a portrait photo stretched over a 16:7 frame is reported as very wide", () => {
    const s = stretchAmount("hero.desktop", free()); // 3:4 image shown at 16:7
    assert.equal(s.direction, "wide");
    assert.ok(s.factor > 3 && s.factor < 3.1, String(s.factor));
  });
  test("an image whose box already has its own proportions is undistorted", () => {
    // 1200x1600 (3:4) inside a 16:7 frame: height 1 frame => width = (3/4) * 7/16 = 0.328 frames
    const s = stretchAmount("hero.desktop", free({ bw: 0.75 * (7 / 16), bh: 1 }));
    assert.equal(s.direction, "none");
    assert.equal(s.factor, 1);
  });
});

describe("resolution check understands the box", () => {
  test("an image kept inside the frame at its own proportions can be sharp; a huge crop of a small image is not", () => {
    const wide = { width: 2560, height: 1120 };
    assert.equal(checkResolution("hero.desktop", free({ w: 2560, h: 1120 }), wide).level, "ok");
    const blown = checkResolution("hero.desktop", free({ w: 800, h: 350, bx: -1, bw: 3 }), { width: 800, height: 350 });
    assert.notEqual(blown.level, "ok");
  });
});

describe("API schema", () => {
  const ok = { mode: "free", zoom: 1, x: 0.5, y: 0.5, w: 1200, h: 1600, bx: 0, by: -0.1, bw: 1, bh: 1.2 };
  test("accepts a stretch framing and stores it canonically", () => {
    assert.deepEqual(framingSchema.parse(ok), { v: 1, ...ok });
    assert.equal(homepageFramingMapSchema.safeParse({ "hero_desktop:khimar": ok }).success, true);
  });
});

describe("editor wiring", () => {
  const src = read("components/admin/imageFraming/ImageFramingEditor.jsx");
  test("offers a Stretch mode with all eight handles, pointer + keyboard operation and a distortion warning", () => {
    assert.match(src, /\["free", "Stretch"/);
    assert.match(src, /FREE_HANDLES\.map/);
    assert.deepEqual([...FREE_HANDLES].sort(), ["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
    assert.match(src, /aria-label=\{`Stretch \$\{meta\.label\}`\}/);
    assert.match(src, /onPointerDown=\{\(e\) => startBoxDrag\(e, handle\)\}/);
    assert.match(src, /onKeyDown=\{\(e\) => onHandleKeyDown\(e, handle\)\}/);
    assert.match(src, /touchAction: "none"/);
    assert.match(src, /stretchAmount\(active, current\)/);
  });
  test("handles live outside the clipped frame so an edge on the border is still grabbable", () => {
    const frameIdx = src.indexOf('data-testid="framing-frame"');
    const overlayIdx = src.indexOf('data-testid="stretch-overlay"');
    assert.ok(frameIdx > -1 && overlayIdx > frameIdx);
    assert.match(src.slice(src.lastIndexOf("<div", frameIdx), frameIdx), /overflow-hidden/);
    assert.doesNotMatch(src.slice(src.lastIndexOf("<div", overlayIdx), overlayIdx), /overflow-hidden/);
  });
});

// The assertion removed from here read the admin framing editor's source.
// That editor moved to the dashboard with the rest of shop management; what
// this file still owns is the framing maths and how the storefront renders
// a framed image.
