# Image framing

A reusable "choose → see the real frame → drag/zoom → preview → save" workflow for
every admin image that is shown in a fixed frame. One rulebook
(`lib/imageFraming.js`) is shared by the editor, the storefront renderer, the API
schemas and the tests, so **what the editor shows is what the site renders**.

## What was wrong

- The homepage hero rendered uploads with `object-contain`, so a portrait or square
  image sat in the middle of a wide box with large empty areas on both sides.
- Uploading gave no hint of the destination's shape or the pixels needed.
- The admin promotion preview used its own boxes (16:6 and 9:12, `object-cover`) that
  never matched the storefront (16:7 and ~1:1, `object-contain`).

## How it works

A saved framing is `{ v, mode, zoom, x, y, w, h }` stored **next to** the image URL:

| field | meaning |
|---|---|
| `mode` | `fill` (cover the frame, crop) or `fit` (whole image, letterbox) |
| `zoom` | 1–4, Fill only — 1 is the tightest "cover", so Fill can never show empty frame |
| `x`, `y` | 0–1 focal position (same meaning as CSS `object-position`) |
| `w`, `h` | the image's pixel size when framed (drives geometry + resolution warnings) |

- **The original is never modified.** Framing is metadata; clearing it (or "Reset")
  restores the untouched original. Uploads go through the existing `/api/upload`
  route unchanged (admin-only, 5 MB, type + signature checks).
- **Storefront = editor.** Both render through `components/ui/FramedImage.jsx`, which
  positions the image with CSS container-query units, so Fill covers the frame's
  *actual* rendered shape (not just the nominal one). Fill and Fit never stretch an image;
  only the admin-chosen **Stretch** mode does (see below).
- **No silent changes.** An image with no saved framing renders exactly as before
  (each renderer keeps its original markup as the unframed branch). Editing an
  existing image only changes the placements that were actually opened.
- **Per placement.** A department image serves a square tile *and* a 4:3 card, so it
  stores one framing for each (`department.tile`, `department.card`).
- **Cancel** discards everything: a *new* file is only uploaded when the editor's
  Save is pressed, and nothing is written until the surrounding form is saved.
- **Orientation.** A JPEG with an EXIF rotation flag is re-drawn upright before
  upload (so a crop can't misalign); files with no flag are uploaded byte-for-byte.

### Stretch — drag the edges to fit exactly

Third mode next to Fill and Fit, for when you want the picture to fill the frame with no
empty space *and* no cropping — accepting that its proportions change.

- Choosing **Stretch** starts with the whole image exactly filling the frame. Eight
  handles then sit on the image: **edge handles** (top / bottom / left / right) resize
  that one side and leave the opposite side where it is; **corner handles** resize
  proportionally (hold **Shift** to move a corner freely). Drag the picture itself to
  move it. An edge can be pulled past the frame (the image is cropped) or pushed inside
  it (empty frame shows).
- Keyboard: Tab to a handle and use the arrow keys (1% of the frame; Shift = 5%); with
  the frame focused the arrows move the picture and `0` resets.
- Touch/pen use the same handles (pointer events, 32px hit area).
- Stored as `mode: "free"` plus `bx, by, bw, bh` — the image's position and size as
  **fractions of the frame** — so it scales with the frame at any screen size and the
  storefront and editor render it with the same percentages. The box is clamped so at
  least 10% of the frame stays covered and no side exceeds 6 frames; the handles can
  therefore always be reached. Fill/Fit records are unchanged (no box fields).
- Because the box is a fraction of the *real* frame, a hero on a wider or narrower screen
  stretches proportionally with it (unlike Fill, which re-covers the frame without
  distortion). The editor shows how much the picture is distorted ("Stretched: 34% wider
  than its original proportions") and turns red from 40%.
- Carry-over from desktop to a phone slot (same image, no phone crop) applies the same
  box, i.e. "fills the frame" stays "fills the frame".

### Desktop / mobile crops and the fallback

Only the hero and the popup change shape between desktop and phone, so only they
have two slots (`desktopImage`/`desktopFraming`, `mobileImage`/`mobileFraming`):

1. A slot's **own** crop is always used.
2. No mobile crop, **same image** in both slots → the desktop crop's mode, zoom and
   focal point are carried over (Fill re-covers the phone frame). The mobile field
   says so and shows exactly that preview.
3. A **separate mobile image** with no crop of its own → rendered as it always was
   (a crop records one image's proportions and can't be applied to another file).
4. No crop at all → unchanged legacy rendering.

### Shop Config → Carousel (department slides)

The four department slides (**Burqa, Abaya, Hijab, Khimar**) each take one image that
is framed for **both** hero shapes (`hero.desktop` and `hero.mobile`, stored in
`settings.homepage.imageFraming` as `hero_desktop:<slug>` / `hero_mobile:<slug>`).

- Leaving a slot blank still uses that department's own top-rated product photo. That
  automatic photo has no crop, so it renders exactly as before — a crop only ever
  applies to an image an admin set here.
- An admin-set image with **no crop saved** (everything set before this feature)
  renders exactly as before; a crop is written only when "Adjust framing" is used or a
  *new* image is uploaded.
- **Khimar** used to have no override slot (it always used the auto photo); it now has
  one like the others. Existing settings are unaffected (the new key is optional).
- For any slide beyond these four, the modal links to **Promotions → Carousel Banners**:
  unlimited slides, each with its own desktop/mobile image, framing, link and schedule.
  While any banner there is live it replaces this department rotation on the storefront.

## Placements — measured, not assumed

Frame sizes below were **measured in a real browser** at 360–1920px wide
(`docs/image-framing/` screenshots, numbers in `lib/imageFraming.js`). "Recommended"
is 2× the widest CSS size (retina), capped at 2560px on the long edge because uploads
are limited to 5 MB. **That is the file size to upload — the on-screen size is
responsive and smaller.**

| Placement | Real frame shape | Widest frame | Recommended file | Minimum |
|---|---|---|---|---|
| Hero — desktop (≥640px) | 16:7 at ~1000–1300px screens; 2:1 on tablets; up to 2.5:1 (1400×560, height-capped) on wide screens | 1400px | **2560×1120** | 1400×613 |
| Hero — mobile (<640px) | **~1:1** on phones (358×360 at 390px) — the layout's 4:3 is overridden by `min-h-[360px]`; becomes 4:3 from ~512px | ~600px | **1200×900** (covers both shapes) | 600×450 |
| Campaign popup — desktop | 2.6–3.9:1 (band = 32% of window height, 180–340px; 3.1:1 at 1440×900) | 896px | **1792×597** | 896×299 |
| Campaign popup — mobile | 1.3–1.6:1 | ~600px | **1200×900** | 600×450 |
| Department — square tile | always 1:1 | 165px | **340×340** | 170×170 |
| Department — homepage card | always 4:3 | 395px | **800×600** | 400×300 |
| Fabric card | 220px tall × 177–358px wide (0.8–2.7:1); ~1.2:1 desktop | ~600px | **1200×1000** | 600×500 |
| Occasion card | 200px tall × 226–358px wide; ~1.6:1 desktop | ~600px | **1200×750** | 600×375 |
| Guided Discovery photo | ~1.5:1 beside the text; 2–3:1 when stacked | ~960px | **1920×1280** | 960×640 |
| Homepage promo banner | 10:3 once framed (unframed = the image's own shape) | 1400px | **2560×768** | 1400×420 |
| Product photo (card + detail) | always 4:5 | 684px (detail page) | **1368×1710** | 684×855 |

Not framed on purpose: logos and favicon (must keep their own proportions), the 80px
gallery thumbnails, and category images (no upload field exists). The
`occasionMenuImage` setting has an upload field but is not rendered anywhere on the
storefront today, so it was left alone.

Defaults: banners/hero/popup → **Fill**, centred; tiles/cards → **Fill**, top-anchored
(matching their old `object-top`); products → **Fit** (show the whole item).

## Resolution warning

The editor compares the pixels the *crop* actually contains with what the frame needs:
`ok` (≥ recommended), `low` (≥ minimum — fine on standard screens, soft on retina) or
`insufficient` (below the minimum — will look blurry). Zooming in lowers it.

## Database — migration `0006_image_framing`

Additive and idempotent (adds nullable JSON columns only; never touches existing
values): `promotions.desktop_framing`, `promotions.mobile_framing`,
`products.image_framing`. Homepage slots live inside `settings.homepage` JSON and need
no schema change. `sql/schema.sql` includes the columns for fresh installs.

Apply to an existing database with:

```bash
CONFIRM_MIGRATE_PRODUCTION=true node --env-file=.env scripts/runMigrations.mjs
```

Until it is applied, everything keeps working; saving a **crop** is refused with a
clear 409 (nothing is written) and ordinary saves are unaffected.

## Verification (disposable test database + real Chrome)

- Fill covers the frame for wide, portrait, square, extreme-wide and extreme-tall
  images at every zoom and position (property test over >1,000 combinations, plus DOM
  measurement: gaps are `0` or negative after extreme drags).
- Fit shows the whole image (portrait hero: 420×560 centred, 470px empty each side —
  intentional).
- Saved crop reloads identically; storefront geometry equals the editor's to 3 decimals.
- Cancel → 0 upload requests, saved image and framing unchanged.
- A failed upload keeps the editor open with the server's message; retry works.
- The uploaded original is byte-identical (SHA-256) for un-rotated files.
- Carousel modal (test DB, real Chrome): a Khimar crop of zoom 1.6 (desktop) and 2.2
  (mobile) saved, and the storefront rendered them exactly — 2176×2901 image in the
  1360×560 desktop frame and 788×1050 in the 358×360 phone frame, every edge covered,
  focal point matching the saved `x`/`y`. An Abaya image saved earlier with no crop
  kept its original `object-contain object-top` classes and was not given a crop by
  saving the modal. Screenshots: `docs/image-framing/carousel-*.png`.
- Stretch (test DB, real Chrome, real mouse/keyboard input): choosing it fills the frame
  exactly (622×272.13 in a 622×272.13 frame); dragging the right edge in by 200px moved
  only that edge; the bottom edge likewise; a proportional corner kept the 1.707 aspect
  with its opposite corner fixed; Shift on a corner changed the aspect; dragging the
  picture moved it 40/15px without resizing it; five ArrowRight presses on the east handle
  grew it 31.1px (5 × 1% of 622); Reset returned to Fill. A saved Khimar box of 100%×100%
  (desktop) and 70%×60% (mobile) rendered on the storefront as 1360×560 in the 1360×560
  desktop frame and 251×216 in the 358×360 phone frame — identical to the editor.
  Screenshots: `docs/image-framing/stretch-*.png`.
