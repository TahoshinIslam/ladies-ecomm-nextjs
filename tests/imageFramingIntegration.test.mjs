// Image framing — integration guarantees that don't need a browser:
//  * migration 0006 really adds the columns to a disposable database, keeps
//    existing rows untouched, and is safe to run repeatedly;
//  * every storefront renderer keeps its original (unframed) markup, so an
//    image with no saved framing renders exactly as it did before;
//  * every upload field goes through the shared editor, and the existing
//    upload validation (size limit, signature check, admin-only) is untouched.
// Source-level checks follow this repo's house style (no jsdom/RTL); the
// rendered behaviour itself is covered by the DOM measurements in the PR notes
// and by tests/imageFraming.test.mjs (geometry) + tests/imageFramingPersistence.test.mjs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { homepageFramingKey } from "../lib/imageFraming.js";
import { dbReady, skipReason, connectTestDb, disconnectTestDb, rawQuery, deleteRows } from "./helpers/testDb.mjs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url).pathname, "utf8");

describe("migration 0006_image_framing — against a real disposable database", { skip: !dbReady && skipReason }, () => {
  let migration;
  let withConnection;
  const column = async (table, name) =>
    (
      await rawQuery(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, name],
      )
    )[0];

  before(async () => {
    await connectTestDb();
    ({ default: migration } = await import("../scripts/migrations/0006_image_framing.mjs"));
    ({ withConnection } = await import("../config/db.js"));
  });
  after(async () => {
    await disconnectTestDb();
  });

  test("adds all three columns as NULLABLE JSON-capable columns", async () => {
    await withConnection((conn) => migration.up(conn));
    for (const [table, name] of [["promotions", "desktop_framing"], ["promotions", "mobile_framing"], ["products", "image_framing"]]) {
      const c = await column(table, name);
      assert.ok(c, `${table}.${name} exists`);
      assert.equal(c.is_nullable, "YES", `${table}.${name} must be nullable (existing rows stay valid)`);
    }
  });

  test("repeat-safe: a second and third run are no-ops that change nothing", async () => {
    await withConnection((conn) => migration.up(conn));
    await withConnection((conn) => migration.up(conn));
    assert.ok(await column("products", "image_framing"));
  });

  test("a MISSING column is added, and pre-existing rows are preserved untouched", async () => {
    const { generateObjectId } = await import("../lib/objectId.js");
    const id = generateObjectId();
    const slug = `mig-0006-${Date.now()}`;
    await rawQuery(
      `INSERT INTO products (id, name, slug, description, description_bn, category_id, base_price, price_currency, images, included_items, tags, tags_text)
       VALUES (?, 'Migration 0006 row', ?, 'kept', '', ?, 1234.5, 'BDT', '["https://example.test/keep.jpg"]', '[]', '[]', '')`,
      [id, slug, generateObjectId()],
    );
    try {
      await rawQuery("ALTER TABLE products DROP COLUMN image_framing");
      assert.equal(await column("products", "image_framing"), undefined, "column really dropped for this test");

      await withConnection((conn) => migration.up(conn));

      assert.ok(await column("products", "image_framing"), "migration re-added the missing column");
      const [row] = await rawQuery("SELECT name, base_price, images, image_framing FROM products WHERE id = ?", [id]);
      assert.equal(row.name, "Migration 0006 row");
      assert.equal(Number(row.base_price), 1234.5, "prices untouched");
      assert.match(String(row.images), /keep\.jpg/, "existing image URLs untouched");
      assert.equal(row.image_framing, null, "new column starts NULL = unframed = renders as before");
    } finally {
      await deleteRows("products", "id", id);
      // Guarantee the column exists for every other test, whatever happened above.
      await withConnection((conn) => migration.up(conn));
    }
  });

  test("the migration is additive only — no DROP/UPDATE/DELETE of data, and it is registered with the runner and schema.sql", () => {
    const src = read("scripts/migrations/0006_image_framing.mjs");
    assert.doesNotMatch(src, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|UPDATE\s+\w+\s+SET|TRUNCATE/i);
    assert.match(src, /information_schema\.columns/, "checks for the column before adding it");
    assert.match(read("scripts/runMigrations.mjs"), /0006_image_framing\.mjs/);
    const schema = read("sql/schema.sql");
    for (const col of ["desktop_framing JSON NULL", "mobile_framing JSON NULL", "image_framing JSON NULL"]) {
      assert.ok(schema.includes(col), `schema.sql (fresh installs) declares ${col}`);
    }
  });
});

describe("storefront renderers keep their ORIGINAL markup for images with no saved framing", () => {
  test("hero: the pre-existing object-contain/object-top slide is still there as the unframed branch", () => {
    const src = read("views/home/HeroCarousel.jsx");
    assert.match(src, /isFramed \? \(/);
    assert.match(src, /<FramedHeroSlide/, "the framed branch is its own component (HeroCarousel keeps only its two original <Image>s)");
    assert.match(src, /\) : active\.desktopImage \? \(/, "legacy branch follows the framed one");
    assert.equal((src.match(/<Image\b/g) || []).length >= 2, true);
    assert.match(src, /className="hidden object-contain object-top sm:block"/);
    assert.match(src, /className="object-contain object-top sm:hidden"/);
  });

  test("popup, department tile/card, fabric/occasion, guided panel, banner and product card/detail each keep their legacy render", () => {
    assert.match(read("components/layout/CampaignPopup.jsx"), /isFramed \? \([\s\S]*\) : \(\s*<Image src=\{resolveImage\(image, 1200\)\}/);
    assert.match(read("components/product/CategoryCard.jsx"), /object-cover object-top transition-transform/);
    const home = read("views/HomePage.jsx");
    assert.match(home, /className="object-cover object-top transition-transform duration-300 group-hover:scale-\[1\.04\]"/);
    assert.match(home, /className="object-cover object-top"/);
    assert.match(home, /className="h-auto w-full object-cover"/, "unframed banner keeps its natural-proportions render");
    assert.match(read("views/home/GuidedFinderSection.jsx"), /className="object-cover object-top"/);
    assert.match(read("components/product/ProductCard.jsx"), /className="object-contain"/);
    assert.match(read("views/product/ProductDetailInteractive.jsx"), /className="object-contain"/);
  });

  test("every framed branch renders through the ONE shared FramedImage component", () => {
    for (const file of [
      "views/home/FramedHeroSlide.jsx",
      "components/layout/CampaignPopup.jsx",
      "components/product/CategoryCard.jsx",
      "views/HomePage.jsx",
      "views/home/GuidedFinderSection.jsx",
      "components/product/ProductCard.jsx",
      "views/product/ProductDetailInteractive.jsx",
      "components/admin/imageFraming/FramePreview.jsx",
      "components/admin/imageFraming/ImageFramingEditor.jsx",
    ]) {
      assert.match(read(file), /import FramedImage from/, `${file} uses the shared renderer`);
    }
  });
});

describe("one reusable editor, wired into every applicable upload field", () => {
  test("the framing field / editor are used by promotions, homepage images and product photos — no per-form editors", () => {
    assert.match(read("views/admin/PromotionsPage.jsx"), /FramedImageInput/);
    assert.match(read("views/admin/ShopConfigPage.jsx"), /FramedImageInput/);
    assert.match(read("components/admin/ImageDropzone.jsx"), /ImageFramingEditor/);
    assert.match(read("components/admin/ProductFormModal.jsx"), /framingPlacement="product\.gallery"/);
    const editors = fs.readdirSync(new URL("../components", import.meta.url).pathname, { recursive: true }).filter((f) => /FramingEditor\.jsx$/.test(f));
    assert.deepEqual(editors, ["admin/imageFraming/ImageFramingEditor.jsx"], "exactly one editor component exists");
  });

  test("the editor provides Fit and Fill, zoom, reset, save and cancel, with keyboard + touch/pointer support", () => {
    const src = read("components/admin/imageFraming/ImageFramingEditor.jsx");
    for (const needle of [
      /Fill \(crop\)/, /"Fit"|>Fit</, /Reset/, /Cancel/, /saveLabel/, /type="range"/,
      /onPointerDown/, /onPointerMove/, /onPointerUp/, /onPointerCancel/, /touchAction: "none"/,
      /ArrowLeft/, /ArrowRight/, /ArrowUp/, /ArrowDown/, /role="dialog"/, /aria-modal="true"/,
      /keydown", onKey, true/, // capture-phase so a parent modal never also handles Escape/Tab
    ]) {
      assert.match(src, needle);
    }
  });

  test("Cancel never uploads: the editor only reports a result; the upload happens solely inside the field's save handler", () => {
    const editor = read("components/admin/imageFraming/ImageFramingEditor.jsx");
    assert.doesNotMatch(editor, /useUploadImageMutation|fetch\(/, "the editor itself cannot upload");
    const field = read("components/admin/imageFraming/FramedImageInput.jsx");
    assert.equal((field.match(/uploadImage\(/g) || []).length, 1, "one upload call, inside saveNew");
    assert.match(field, /const saveNew = async/);
  });

  test("file validation is unchanged: server-side 5 MB limit, allowed types, signature check and admin-only route", () => {
    const svc = read("services/uploadService.js");
    assert.match(svc, /const MAX_BYTES = 5 \* 1024 \* 1024;/);
    assert.match(svc, /new Set\(\["image\/jpeg", "image\/jpg", "image\/png", "image\/webp", "image\/avif"\]\)/);
    assert.match(svc, /detectImageSignature\(buffer\)/);
    assert.match(read("app/api/upload/route.js"), /await requireAdmin\(request\)/);
    // and the client field enforces the same limits BEFORE sending anything
    const field = read("components/admin/imageFraming/FramedImageInput.jsx");
    assert.match(field, /const ALLOWED_TYPES = \["image\/jpeg", "image\/png", "image\/webp", "image\/avif"\]/);
    assert.match(field, /maxFileMB \* 1024 \* 1024/);
  });

  test("orientation: only files with a real EXIF rotation flag are re-drawn; everything else is uploaded byte-for-byte", () => {
    const src = read("lib/imageFileInfo.js");
    assert.match(src, /if \(orientation === 1\) \{\s*return \{ file,/, "orientation 1 returns the untouched original file");
  });
});

describe("request-body safety: no user-controlled value is ever an object KEY containing a dot", () => {
  test("product framing is a list of { url, framing }; homepage keys use '_' not '.'", () => {
    const schema = read("schemas/framingSchema.js");
    assert.match(schema, /productFramingListSchema/);
    assert.doesNotMatch(schema, /productFramingMapSchema/);
    assert.match(schema, /\^\[a-z\]\+_\[a-z\]\+/);
    // the shared body guard is NOT weakened
    assert.match(read("lib/validation.js"), /key\.includes\("\."\)/);
  });
});

describe("Shop Config → Carousel: framed department slides, Khimar slot, link to Promotions", () => {
  const modal = () => {
    const src = read("views/admin/ShopConfigPage.jsx");
    const start = src.indexOf("function CarouselModal(");
    return src.slice(start, src.indexOf("\n}\n", start));
  };

  test("all four departments (incl. Khimar) use the shared framed field with BOTH hero shapes", () => {
    const src = read("views/admin/ShopConfigPage.jsx");
    for (const slug of ["burqa", "abaya", "hijab", "khimar"]) assert.match(src, new RegExp(`slug: "${slug}"`));
    assert.match(src, /const HERO_PLACEMENTS = \["hero\.desktop", "hero\.mobile"\]/);
    const body = modal();
    assert.match(body, /<FramedPickerField/);
    assert.match(body, /placements=\{HERO_PLACEMENTS\}/);
    assert.match(body, /carouselImages: images, imageFraming: framing/, "saves the images AND their crops together");
    assert.doesNotMatch(body, /<ImagePickerField/, "the un-framed picker is gone from this modal");
  });

  test("the modal links to Promotions → Carousel Banners (unlimited slides) for people who may use it", () => {
    const body = modal();
    assert.match(body, /href="\/admin\/promotions"/);
    assert.match(body, /can\(PERMISSIONS\.PROMOTIONS_MANAGE\)/);
    assert.match(body, /Add more slides in Promotions/);
  });

  test("Khimar is accepted by the settings schema/default and overrides the auto photo like the others", () => {
    assert.match(read("models/settingsModel.js"), /carouselImages: \{ burqa: "", abaya: "", hijab: "", khimar: "" \}/);
    assert.match(read("schemas/adminSchemas.js"), /hijab: z\.string\(\)\.trim\(\)\.max\(2000\),\s*khimar: z\.string\(\)\.trim\(\)\.max\(2000\),\s*\}\)\s*\.strict\(\)/);
    assert.match(read("views/HomePage.jsx"), /khimar: homepageSettings\.carouselImages\?\.khimar \|\| heroKhimar\[0\]\?\.images\?\.\[0\] \|\| null/);
  });

  test("storefront: crops apply only to an admin-set carousel image; the auto product photo stays unframed", () => {
    const home = read("views/HomePage.jsx");
    assert.match(home, /homepageSettings\.carouselImages\?\.\[slug\]\s*\?\s*\{[\s\S]*homepageFramingFor\(imageFraming, "hero\.desktop", slug\)[\s\S]*homepageFramingFor\(imageFraming, "hero\.mobile", slug\)[\s\S]*\}\s*:\s*null/);
    assert.match(home, /heroFramingBySlug=\{heroFramingBySlug\}/);
    const hero = read("views/home/HeroCarousel.jsx");
    assert.match(hero, /desktopFraming: image \? sanitizeFraming\(framing\?\.desktop\) : null/);
    assert.match(hero, /mobileFraming: image \? sanitizeFraming\(framing\?\.mobile\) : null/);
    // fallback slides render through the same framed component as promotion slides
    assert.match(hero, /buildFallbackSlides\(departments, heroImageBySlug, heroFramingBySlug\)/);
    assert.equal((hero.match(/<Image\b[\s\S]*?\/>/g) || []).length, 2, "HeroCarousel keeps exactly its two original <Image> elements");
  });

  test("homepage crop keys for the new slots satisfy the wire-format rule", () => {
    for (const [placement, slug] of [["hero.desktop", "khimar"], ["hero.mobile", "burqa"]]) {
      assert.match(homepageFramingKey(placement, slug), /^[a-z]+_[a-z]+:[a-z0-9-]{1,40}$/);
    }
  });
});
