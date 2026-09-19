// lib/imageFraming.js — the one rulebook the admin framing editor, the
// storefront renderer and the API schemas all share. These tests pin the
// guarantees the feature promises: Fill never exposes empty frame, Fit always
// shows the whole image, only an admin-chosen "Stretch" ever distorts one (see
// tests/imageFramingStretch.test.mjs), and the recommended
// dimensions are derived from the real layouts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ZOOM,
  PLACEMENTS,
  checkResolution,
  defaultFraming,
  formatAspect,
  framedImageRect,
  framedImageStyle,
  homepageFramingFor,
  panFraming,
  parseFramingColumn,
  parseFramingListColumn,
  framingForUrl,
  setFramingForUrl,
  pruneFramingList,
  homepageFramingKey,
  recommendedSource,
  resolveSlotFraming,
  sanitizeFraming,
  scaleSizes,
  setFramingMode,
  widthFactor,
  zoomFraming,
} from "../lib/imageFraming.js";
import { framingSchema, homepageFramingMapSchema, productFramingListSchema } from "../schemas/framingSchema.js";

const EPS = 1e-6;

// Wide, portrait, square, extreme-wide, extreme-tall.
const IMAGES = [
  { w: 2400, h: 1000 },
  { w: 1000, h: 1500 },
  { w: 1200, h: 1200 },
  { w: 4000, h: 500 },
  { w: 500, h: 4000 },
];
const FRAMES = [
  [640, 280], // hero desktop 16:7
  [600, 450], // 4:3
  [200, 200], // square
  [700, 210], // 10:3 banner
  [400, 500], // 4:5 product
  [1400, 560], // hero at its 560px height cap (wider than 16:7)
];

describe("Fill covers the whole frame — for every image shape, frame shape, zoom and position", () => {
  test("no empty frame area is ever exposed (property check over a grid of inputs)", () => {
    let checked = 0;
    for (const img of IMAGES) {
      for (const [fw, fh] of FRAMES) {
        for (const zoom of [1, 1.25, 2, MAX_ZOOM]) {
          for (const x of [0, 0.3, 0.5, 1]) {
            for (const y of [0, 0.5, 0.9, 1]) {
              const r = framedImageRect({ mode: "fill", zoom, x, y, w: img.w, h: img.h }, fw, fh);
              assert.ok(r.left <= EPS, `left edge exposed (${JSON.stringify({ img, fw, fh, zoom, x, y })})`);
              assert.ok(r.top <= EPS, "top edge exposed");
              assert.ok(r.left + r.width >= fw - EPS, "right edge exposed");
              assert.ok(r.top + r.height >= fh - EPS, "bottom edge exposed");
              checked += 1;
            }
          }
        }
      }
    }
    assert.ok(checked > 1000);
  });

  test("panning and zooming can never push the image off the frame (clamped by construction)", () => {
    let f = { mode: "fill", zoom: 1.5, x: 0.5, y: 0.5, w: 2400, h: 1000 };
    const [fw, fh] = [640, 280];
    for (const [dx, dy] of [[9999, 9999], [-9999, -9999], [40, -30], [-500, 500]]) {
      f = panFraming(f, dx, dy, fw, fh);
      const r = framedImageRect(f, fw, fh);
      assert.ok(f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1);
      assert.ok(r.left <= EPS && r.top <= EPS && r.left + r.width >= fw - EPS && r.top + r.height >= fh - EPS);
    }
    for (const z of [0.2, 1, 2.5, 99]) {
      f = zoomFraming(f, z, fw, fh);
      assert.ok(f.zoom >= 1 && f.zoom <= MAX_ZOOM, `zoom ${z} -> ${f.zoom}`);
      const r = framedImageRect(f, fw, fh);
      assert.ok(r.left <= EPS && r.top <= EPS && r.left + r.width >= fw - EPS && r.top + r.height >= fh - EPS);
    }
  });

  test("minimum zoom is exactly 1 (the tightest 'cover'), so the image can never be shrunk below the frame", () => {
    const f = zoomFraming({ mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 1000, h: 1000 }, 0.1, 400, 300);
    assert.equal(f.zoom, 1);
  });
});

describe("Fit always shows the whole image", () => {
  test("the whole image is inside the frame, centred by default, at every shape combination", () => {
    for (const img of IMAGES) {
      for (const [fw, fh] of FRAMES) {
        const r = framedImageRect({ mode: "fit", zoom: 1, x: 0.5, y: 0.5, w: img.w, h: img.h }, fw, fh);
        assert.ok(r.left >= -EPS && r.top >= -EPS, "fit image starts inside the frame");
        assert.ok(r.left + r.width <= fw + EPS && r.top + r.height <= fh + EPS, "fit image ends inside the frame");
        // ...and it is as large as it can be: touches at least one pair of edges.
        assert.ok(Math.abs(r.width - fw) < 1e-6 || Math.abs(r.height - fh) < 1e-6, "fit uses the full frame in one dimension");
      }
    }
  });

  test("zoom is ignored in Fit (it always shows the whole image)", () => {
    const f = sanitizeFraming({ mode: "fit", zoom: 3, x: 0.5, y: 0.5, w: 1000, h: 500 });
    assert.equal(f.zoom, 1);
  });
});

describe("images are never stretched", () => {
  test("rendered width/height keeps the image's own aspect ratio in every mode", () => {
    for (const img of IMAGES) {
      for (const mode of ["fill", "fit"]) {
        for (const zoom of [1, 2.7]) {
          const r = framedImageRect({ mode, zoom, x: 0.2, y: 0.8, w: img.w, h: img.h }, 640, 280);
          assert.ok(Math.abs(r.width / r.height - img.w / img.h) < 1e-9, `${mode} stretched a ${img.w}x${img.h} image`);
        }
      }
    }
  });

  test("the CSS the storefront gets encodes the image's aspect and uses container units (no fixed px)", () => {
    const css = framedImageStyle({ mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 2400, h: 1000 });
    assert.equal(css.aspectRatio, "2.4");
    assert.match(css["--fr-w"], /max\(100cqw, 100cqh \* 2\.4\)/);
    assert.match(css.left, /100cqw/);
    assert.match(css.top, /100cqh/);
    assert.equal(css.height, "auto");
    assert.doesNotMatch(JSON.stringify(css), /px/);
  });

  test("Fit CSS uses min() (contain) where Fill uses max() (cover)", () => {
    const fit = framedImageStyle({ mode: "fit", zoom: 1, x: 0.5, y: 0.5, w: 1000, h: 1500 });
    assert.match(fit["--fr-w"], /min\(100cqw/);
  });
});

describe("panning moves the visible window the natural way", () => {
  test("dragging the image right reveals more of its left side (x decreases), and vice-versa", () => {
    const f = { mode: "fill", zoom: 2, x: 0.5, y: 0.5, w: 1600, h: 900 };
    assert.ok(panFraming(f, 50, 0, 640, 280).x < 0.5);
    assert.ok(panFraming(f, -50, 0, 640, 280).x > 0.5);
    assert.ok(panFraming(f, 0, 30, 640, 280).y < 0.5);
  });

  test("a drag that would change nothing (no overflow on that axis) leaves that axis alone", () => {
    // 16:7 image in a 16:7 frame at zoom 1 has zero overflow on both axes.
    const f = { mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 1600, h: 700 };
    const moved = panFraming(f, 80, 80, 640, 280);
    assert.equal(moved.x, 0.5);
    assert.equal(moved.y, 0.5);
  });

  test("zooming keeps whatever is at the frame centre where it is (as far as the edges allow)", () => {
    const f = { mode: "fill", zoom: 1, x: 0.2, y: 0.5, w: 2400, h: 1000 };
    const [fw, fh] = [640, 280];
    const before = framedImageRect(f, fw, fh);
    const u = (fw / 2 - before.left) / before.width;
    const zoomed = zoomFraming(f, 2, fw, fh);
    const after = framedImageRect(zoomed, fw, fh);
    const uAfter = (fw / 2 - after.left) / after.width;
    assert.ok(Math.abs(u - uAfter) < 1e-3, `centre drifted ${u} -> ${uAfter}`);
  });
});

describe("sanitizeFraming / persistence parsing", () => {
  test("rejects unusable input and clamps out-of-range values", () => {
    assert.equal(sanitizeFraming(null), null);
    assert.equal(sanitizeFraming({ mode: "stretch", zoom: 1, x: 0, y: 0, w: 10, h: 10 }), null);
    assert.equal(sanitizeFraming({ mode: "fill", zoom: 1, x: 0, y: 0, w: 0, h: 10 }), null);
    assert.equal(sanitizeFraming({ mode: "fill", zoom: 1, x: NaN, y: 0, w: 10, h: 10 }), null);
    const c = sanitizeFraming({ mode: "fill", zoom: 99, x: -3, y: 7, w: 1000.4, h: 500.6 });
    assert.deepEqual(c, { v: 1, mode: "fill", zoom: MAX_ZOOM, x: 0, y: 1, w: 1000, h: 501 });
  });

  test("DB JSON columns parse from a string OR an already-parsed value, and bad data never throws", () => {
    const f = { v: 1, mode: "fill", zoom: 1.5, x: 0.25, y: 0.75, w: 1200, h: 800 };
    assert.deepEqual(parseFramingColumn(JSON.stringify(f)), f);
    assert.deepEqual(parseFramingColumn(f), f);
    assert.equal(parseFramingColumn(null), null);
    assert.equal(parseFramingColumn("{not json"), null);
    const list = [{ url: "https://x/a.jpg", framing: f }, { url: "https://x/bad.jpg", framing: { mode: "x" } }, { url: "https://x/a.jpg", framing: f }];
    assert.deepEqual(parseFramingListColumn(JSON.stringify(list)), [{ url: "https://x/a.jpg", framing: f }], "invalid and duplicate entries are dropped");
    assert.deepEqual(parseFramingListColumn(list), [{ url: "https://x/a.jpg", framing: f }]);
    assert.deepEqual(parseFramingListColumn(undefined), []);
    assert.deepEqual(parseFramingListColumn("{not json"), []);
    assert.deepEqual(parseFramingListColumn('{"a":1}'), []);
  });

  test("per-photo framing list: lookup, upsert, removal and pruning by URL", () => {
    const f = { v: 1, mode: "fit", zoom: 1, x: 0.5, y: 0.5, w: 900, h: 1200 };
    const g = { ...f, mode: "fill", zoom: 2 };
    let list = setFramingForUrl([], "https://x/a.jpg", f);
    list = setFramingForUrl(list, "https://x/b.jpg", g);
    assert.deepEqual(framingForUrl(list, "https://x/b.jpg"), g);
    assert.equal(framingForUrl(list, "https://x/none.jpg"), null);
    assert.equal(framingForUrl(undefined, "https://x/a.jpg"), null);
    list = setFramingForUrl(list, "https://x/a.jpg", { ...f, mode: "fill", zoom: 1.5 });
    assert.equal(list.length, 2, "updating replaces, never duplicates");
    assert.equal(framingForUrl(list, "https://x/a.jpg").zoom, 1.5);
    assert.equal(setFramingForUrl(list, "https://x/a.jpg", null).length, 1, "null removes");
    assert.deepEqual(pruneFramingList(list, ["https://x/b.jpg"]).map((e) => e.url), ["https://x/b.jpg"]);
  });

  test("homepage framing lookup uses '<placement>' and '<placement>:<slug>' keys with '.' written '_'", () => {
    const f = { v: 1, mode: "fill", zoom: 1, x: 0.5, y: 0, w: 800, h: 800 };
    assert.equal(homepageFramingKey("department.tile", "burqa"), "department_tile:burqa");
    assert.equal(homepageFramingKey("banner.home"), "banner_home");
    const map = { "department_tile:burqa": f, banner_home: f };
    assert.deepEqual(homepageFramingFor(map, "department.tile", "burqa"), f);
    assert.deepEqual(homepageFramingFor(map, "banner.home"), f);
    assert.equal(homepageFramingFor(map, "department.tile", "abaya"), null);
    assert.equal(homepageFramingFor(undefined, "banner.home"), null);
  });
});

describe("API schemas share the same rules", () => {
  const ok = { mode: "fill", zoom: 1.5, x: 0.4, y: 0.6, w: 2000, h: 900 };

  test("accepts a valid framing and re-normalizes it (adds the version stamp)", () => {
    assert.deepEqual(framingSchema.parse(ok), { v: 1, ...ok });
  });

  test("rejects out-of-range, unknown-field and wrong-type input", () => {
    for (const bad of [
      { ...ok, zoom: 9 },
      { ...ok, zoom: 0.5 },
      { ...ok, x: 1.2 },
      { ...ok, w: -1 },
      { ...ok, mode: "stretch" },
      { ...ok, extra: 1 },
      { ...ok, x: "0.5" },
    ]) {
      assert.equal(framingSchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });

  test("homepage map keys must look like a placement (no arbitrary or dotted keys); the product list carries URLs as values", () => {
    assert.equal(homepageFramingMapSchema.safeParse({ banner_home: ok, "department_tile:modest-sets": ok }).success, true);
    assert.equal(homepageFramingMapSchema.safeParse({ "banner.home": ok }).success, false, "dots are rejected (request-body guard)");
    assert.equal(homepageFramingMapSchema.safeParse({ "../../etc": ok }).success, false);
    assert.equal(homepageFramingMapSchema.safeParse({ __proto__: ok, constructor: ok }).success, false);
    assert.equal(productFramingListSchema.safeParse([{ url: "https://res.cloudinary.com/x/a.jpg", framing: ok }]).success, true);
    assert.equal(productFramingListSchema.safeParse([{ url: "", framing: ok }]).success, false);
    assert.equal(productFramingListSchema.safeParse([{ url: "https://x/a.jpg", framing: ok, extra: 1 }]).success, false);
  });
});

describe("placement registry — recommended dimensions come from the real layouts", () => {
  test("every placement has a positive aspect, a layout note and a legacy render", () => {
    for (const [key, p] of Object.entries(PLACEMENTS)) {
      assert.ok(p.aspect[0] > 0 && p.aspect[1] > 0, key);
      assert.ok(p.maxCssWidth > 0, key);
      assert.ok(p.layout.length > 20, key);
      assert.ok(p.legacy.natural || p.legacy.fit, key);
      assert.ok(["fill", "fit"].includes(p.defaultMode), key);
    }
  });

  test("recommended = 2x the frame's measured widest CSS size (capped at 2560px on the long edge); minimum = 1x", () => {
    const expected = {
      "hero.desktop": { rec: [2560, 1120], min: [1400, 613] },
      "hero.mobile": { rec: [1200, 900], min: [600, 450] },
      "popup.desktop": { rec: [1792, 597], min: [896, 299] },
      "popup.mobile": { rec: [1200, 900], min: [600, 450] },
      "department.tile": { rec: [340, 340], min: [170, 170] },
      "department.card": { rec: [800, 600], min: [400, 300] },
      "fabric.tile": { rec: [1200, 1000], min: [600, 500] },
      "occasion.tile": { rec: [1200, 750], min: [600, 375] },
      "guided.panel": { rec: [1920, 1280], min: [960, 640] },
      "banner.home": { rec: [2560, 768], min: [1400, 420] },
      "product.gallery": { rec: [1368, 1710], min: [684, 855] },
    };
    for (const [key, { rec, min }] of Object.entries(expected)) {
      const r = recommendedSource(key);
      assert.deepEqual([r.recommended.width, r.recommended.height], rec, `${key} recommended`);
      assert.deepEqual([r.minimum.width, r.minimum.height], min, `${key} minimum`);
      // recommended keeps the file shape the placement asks for (within rounding)
      const [aw, ah] = PLACEMENTS[key].sourceAspect || PLACEMENTS[key].aspect;
      assert.ok(Math.abs(r.recommended.width / r.recommended.height - aw / ah) < 0.01, key);
    }
  });

  test("no recommendation asks for an edge above the 2560px cap", () => {
    for (const key of Object.keys(PLACEMENTS)) {
      const r = recommendedSource(key).recommended;
      assert.ok(Math.max(r.width, r.height) <= 2560, `${key} ${r.width}x${r.height}`);
    }
  });

  test("aspect labels read as ratios", () => {
    assert.equal(formatAspect("hero.desktop"), "16:7");
    assert.equal(formatAspect("hero.mobile"), "1:1");
    assert.equal(formatAspect("popup.desktop"), "3:1");
    assert.equal(formatAspect("banner.home"), "10:3");
    assert.equal(formatAspect("product.gallery"), "4:5");
  });

  test("defaults: banners/hero Fill (centred), tiles Fill anchored top (matching their old object-top), products Fit", () => {
    const d = { width: 2000, height: 1000 };
    assert.deepEqual(defaultFraming("hero.desktop", d), { v: 1, mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 2000, h: 1000 });
    assert.deepEqual(defaultFraming("banner.home", d), { v: 1, mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 2000, h: 1000 });
    assert.equal(defaultFraming("department.tile", d).y, 0);
    assert.equal(defaultFraming("product.gallery", d).mode, "fit");
  });

  test("switching mode resets to that mode's sane starting point", () => {
    const d = { width: 2000, height: 1000 };
    const fit = setFramingMode(defaultFraming("hero.desktop", d), "fit", "hero.desktop", d);
    assert.deepEqual([fit.mode, fit.zoom, fit.x, fit.y], ["fit", 1, 0.5, 0.5]);
    const fill = setFramingMode(fit, "fill", "department.tile", d);
    assert.deepEqual([fill.mode, fill.zoom, fill.x, fill.y], ["fill", 1, 0.5, 0]);
  });
});

describe("resolution warnings", () => {
  test("a 2560x1120 hero image is fine; a small one warns; in between is 'low'", () => {
    const at = (w, h) => checkResolution("hero.desktop", null, { width: w, height: h });
    assert.equal(at(2560, 1120).level, "ok");
    assert.equal(at(1500, 656).level, "low"); // >= 1280 css px but below 2560 retina
    const tiny = at(800, 350);
    assert.equal(tiny.level, "insufficient");
    assert.match(tiny.message, /blurry/);
  });

  test("zooming in shrinks the visible crop and can turn a fine image into an insufficient one", () => {
    const dims = { width: 2560, height: 1120 };
    const base = defaultFraming("hero.desktop", dims);
    assert.equal(checkResolution("hero.desktop", base, dims).level, "ok");
    const zoomed = { ...base, zoom: 3 };
    assert.equal(checkResolution("hero.desktop", zoomed, dims).level, "insufficient");
  });

  test("the crop — not the whole file — is what gets checked in Fill (wide image into a tall frame)", () => {
    // 4000x500 into 4:5 product frame at Fill: only ~400px of width is visible.
    const dims = { width: 4000, height: 500 };
    const fill = setFramingMode(null, "fill", "product.gallery", dims);
    assert.equal(checkResolution("product.gallery", fill, dims).level, "insufficient");
    const fit = setFramingMode(null, "fit", "product.gallery", dims);
    assert.equal(checkResolution("product.gallery", fit, dims).level, "ok"); // whole 4000px image across 684px
  });
});

describe("fallbacks and helpers", () => {
  const f = { v: 1, mode: "fill", zoom: 1.4, x: 0.3, y: 0.6, w: 2000, h: 900 };

  test("a slot's own crop always wins", () => {
    const own = { ...f, x: 0.9 };
    assert.equal(resolveSlotFraming({ own, ownSrc: "a", other: f, otherSrc: "a" }).x, 0.9);
  });

  test("the other slot's crop is carried over ONLY when both slots show the same image", () => {
    assert.equal(resolveSlotFraming({ own: null, ownSrc: "same.jpg", other: f, otherSrc: "same.jpg" }).zoom, 1.4);
    assert.equal(resolveSlotFraming({ own: null, ownSrc: "mobile.jpg", other: f, otherSrc: "desktop.jpg" }), null);
    assert.equal(resolveSlotFraming({ own: null, ownSrc: "", other: f, otherSrc: "" }), null);
    assert.equal(resolveSlotFraming({ own: null, ownSrc: "a", other: null, otherSrc: "a" }), null);
  });

  test("scaleSizes multiplies every entry of a sizes attribute, keeping media conditions", () => {
    assert.equal(scaleSizes("100vw", 1), "100vw");
    assert.equal(scaleSizes("100vw", 1.5), "calc(100vw * 1.5)");
    assert.equal(
      scaleSizes("(max-width: 1024px) 50vw, 25vw", 2),
      "(max-width: 1024px) calc(50vw * 2), calc(25vw * 2)",
    );
    assert.equal(scaleSizes(undefined, 2), undefined);
  });

  test("widthFactor: a wide image in a narrower frame renders wider than the frame; Fit never does", () => {
    const wide = { v: 1, mode: "fill", zoom: 1, x: 0.5, y: 0.5, w: 2400, h: 1000 };
    assert.ok(widthFactor(wide, "hero.mobile") > 1); // 2.4 vs 1.33
    assert.equal(widthFactor({ ...wide, mode: "fit" }, "hero.mobile"), 1);
    assert.ok(widthFactor({ v: 1, mode: "fit", zoom: 1, x: 0.5, y: 0.5, w: 500, h: 4000 }, "hero.desktop") < 1);
    assert.equal(widthFactor(null, "hero.desktop"), 1);
  });
});
