// Image-framing persistence against the real (disposable) test database:
// promotions (hero + popup crops), homepage image slots, and product photos.
// Covers save -> reload round-trips, validation, "a crop belongs to one
// specific image", clearing, and the guard for a database where migration
// 0006_image_framing hasn't been applied yet. Requires the 0006 columns —
// present in sql/schema.sql for fresh (CI) databases.
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
  createTestCategory,
  deleteRows,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

const HERO_D = { mode: "fill", zoom: 1.4, x: 0.25, y: 0.6, w: 2400, h: 1000 };
const HERO_M = { mode: "fill", zoom: 1, x: 0.8, y: 0.5, w: 1200, h: 1600 };
const CANON = (f) => ({ v: 1, ...f });
const entry = (url, framing) => ({ url, framing });

describe("image framing persistence", { skip: !canRun && reason }, () => {
  let Promotion, Product, Category;
  let promosPOST, promoPUT, promoDuplicatePOST, productsPOST, productPUT, settingsPUT, settingsGET;
  let getEligiblePromotionsBase, getSettings, updateSettings;
  const madePromotions = [];
  const madeProducts = [];
  const madeCategories = [];
  let admin;
  let originalHomepage;

  before(async () => {
    await connectTestDb();
    ({ default: Promotion } = await import("../models/promotionModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ POST: promosPOST } = await import("../app/api/promotions/route.js"));
    ({ PUT: promoPUT } = await import("../app/api/promotions/[id]/route.js"));
    ({ POST: promoDuplicatePOST } = await import("../app/api/promotions/[id]/duplicate/route.js"));
    ({ POST: productsPOST } = await import("../app/api/products/route.js"));
    ({ PUT: productPUT } = await import("../app/api/products/[idOrSlug]/route.js"));
    ({ PUT: settingsPUT, GET: settingsGET } = await import("../app/api/settings/route.js"));
    ({ getEligiblePromotionsBase } = await import("../services/promotionService.js"));
    ({ getSettings, updateSettings } = await import("../services/settingsService.js"));
    admin = await createTestUser({ role: "admin" });
    originalHomepage = (await getSettings()).homepage;
  });

  after(async () => {
    try {
      if (originalHomepage) await updateSettings({ homepage: originalHomepage });
      await deleteRows("promotions", "id", madePromotions);
      await deleteRows("products", "id", madeProducts);
      await deleteRows("categories", "id", madeCategories);
      await deleteRows("customers", "id", admin._id);
    } finally {
      await disconnectTestDb();
    }
  });

  const asAdmin = async (method, url, body) =>
    requestAs({ method, url, session: await createTestSession(admin._id), body });
  const promoBody = (extra = {}) => ({
    name: `Framing ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "carousel",
    desktopImage: "https://example.test/wide.jpg",
    targetType: "none",
    ...extra,
  });
  const promoParams = (p) => ({ params: Promise.resolve({ id: String(p._id) }) });
  async function createPromo(extra) {
    const res = await promosPOST(await asAdmin("POST", "http://test/api/promotions", promoBody(extra)));
    assert.equal(res.status, 201, await res.clone().text());
    const { promotion } = await res.json();
    madePromotions.push(promotion._id);
    return promotion;
  }

  describe("promotions (hero / popup)", () => {
    test("desktop + mobile framing survive create -> reload exactly (canonicalised)", async () => {
      const created = await createPromo({ desktopFraming: HERO_D, mobileFraming: HERO_M });
      const reloaded = await Promotion.findById(created._id);
      assert.deepEqual(reloaded.desktopFraming, CANON(HERO_D));
      assert.deepEqual(reloaded.mobileFraming, CANON(HERO_M));
    });

    test("a promotion created WITHOUT framing reads back as unframed (null) — legacy render", async () => {
      const created = await createPromo();
      const reloaded = await Promotion.findById(created._id);
      assert.equal(reloaded.desktopFraming, null);
      assert.equal(reloaded.mobileFraming, null);
    });

    test("the public DTO carries the framing so the storefront renders the same crop the editor saved", async () => {
      const created = await createPromo({ status: "active", desktopFraming: HERO_D });
      const dtos = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      const dto = dtos.find((d) => d.id === String(created._id));
      assert.ok(dto, "promotion is eligible");
      assert.deepEqual(dto.desktopFraming, CANON(HERO_D));
      assert.equal(dto.mobileFraming, null);
    });

    test("invalid framing is rejected (400): out-of-range zoom, unknown mode, extra fields, bad types", async () => {
      for (const bad of [
        { ...HERO_D, zoom: 9 },
        { ...HERO_D, zoom: 0.4 },
        { ...HERO_D, mode: "stretch" },
        { ...HERO_D, x: 1.5 },
        { ...HERO_D, w: 0 },
        { ...HERO_D, injected: true },
        "fill",
      ]) {
        const res = await promosPOST(await asAdmin("POST", "http://test/api/promotions", promoBody({ desktopFraming: bad })));
        assert.equal(res.status, 400, JSON.stringify(bad));
      }
    });

    test("editing unrelated fields keeps the saved crop; sending null clears it", async () => {
      const created = await createPromo({ desktopFraming: HERO_D });
      let res = await promoPUT(await asAdmin("PUT", `http://test/api/promotions/${created._id}`, { title: "Headline" }), promoParams(created));
      assert.equal(res.status, 200);
      assert.deepEqual((await Promotion.findById(created._id)).desktopFraming, CANON(HERO_D));

      res = await promoPUT(await asAdmin("PUT", `http://test/api/promotions/${created._id}`, { desktopFraming: null }), promoParams(created));
      assert.equal(res.status, 200);
      assert.equal((await Promotion.findById(created._id)).desktopFraming, null);
    });

    test("replacing the image WITHOUT a new crop clears the old crop (a crop describes one specific picture)", async () => {
      const created = await createPromo({ desktopFraming: HERO_D, mobileImage: "https://example.test/m.jpg", mobileFraming: HERO_M });
      const res = await promoPUT(
        await asAdmin("PUT", `http://test/api/promotions/${created._id}`, { desktopImage: "https://example.test/other.jpg" }),
        promoParams(created),
      );
      assert.equal(res.status, 200);
      const reloaded = await Promotion.findById(created._id);
      assert.equal(reloaded.desktopFraming, null, "desktop crop cleared");
      assert.deepEqual(reloaded.mobileFraming, CANON(HERO_M), "the untouched mobile slot keeps its crop");
    });

    test("replacing the image WITH a new crop saves that crop", async () => {
      const created = await createPromo({ desktopFraming: HERO_D });
      const next = { mode: "fit", zoom: 1, x: 0.5, y: 0.5, w: 800, h: 800 };
      await promoPUT(
        await asAdmin("PUT", `http://test/api/promotions/${created._id}`, { desktopImage: "https://example.test/sq.jpg", desktopFraming: next }),
        promoParams(created),
      );
      assert.deepEqual((await Promotion.findById(created._id)).desktopFraming, CANON(next));
    });

    test("changing a crop counts as a creative change (version bumps, so a popup re-shows)", async () => {
      const created = await createPromo({ desktopFraming: HERO_D });
      const before = (await Promotion.findById(created._id)).version;
      await promoPUT(await asAdmin("PUT", `http://test/api/promotions/${created._id}`, { desktopFraming: { ...HERO_D, x: 0.9 } }), promoParams(created));
      assert.equal((await Promotion.findById(created._id)).version, before + 1);
    });

    test("duplicating a promotion carries its crops", async () => {
      const created = await createPromo({ desktopFraming: HERO_D, mobileFraming: HERO_M });
      const res = await promoDuplicatePOST(await asAdmin("POST", `http://test/api/promotions/${created._id}/duplicate`), promoParams(created));
      assert.equal(res.status, 201);
      const { promotion } = await res.json();
      madePromotions.push(promotion._id);
      const copy = await Promotion.findById(promotion._id);
      assert.deepEqual(copy.desktopFraming, CANON(HERO_D));
      assert.deepEqual(copy.mobileFraming, CANON(HERO_M));
    });

    test("on a database WITHOUT migration 0006: saving a crop is refused (409) before anything is written; a plain save still works", async () => {
      const spy = mock.method(Promotion, "framingInstalled", async () => false);
      try {
        const name = `Unmigrated ${Date.now()}`;
        const res = await promosPOST(await asAdmin("POST", "http://test/api/promotions", promoBody({ name, desktopFraming: HERO_D })));
        assert.equal(res.status, 409);
        assert.match((await res.json()).message, /migration 0006/);
        const all = await Promotion.findAll();
        assert.equal(all.some((p) => p.name === name), false, "nothing was created");

        const plain = await promosPOST(await asAdmin("POST", "http://test/api/promotions", promoBody()));
        assert.equal(plain.status, 201);
        madePromotions.push((await plain.json()).promotion._id);
      } finally {
        spy.mock.restore();
      }
    });
  });

  describe("homepage image slots (settings.homepage.imageFraming)", () => {
    const tile = { mode: "fill", zoom: 1.2, x: 0.5, y: 0, w: 1000, h: 1000 };
    const banner = { mode: "fill", zoom: 1, x: 0.5, y: 0.4, w: 2560, h: 768 };

    async function putHomepage(homepage) {
      return settingsPUT(await asAdmin("PUT", "http://test/api/settings", { homepage }));
    }

    test("saved crops round-trip through the settings API and the service", async () => {
      const res = await putHomepage({ imageFraming: { "department_tile:burqa": tile, banner_home: banner, guided_panel: tile } });
      assert.equal(res.status, 200, await res.clone().text());
      const reloaded = (await getSettings()).homepage.imageFraming;
      assert.deepEqual(reloaded["department_tile:burqa"], CANON(tile));
      assert.deepEqual(reloaded.banner_home, CANON(banner));
      const viaApi = await (await settingsGET(await asAdmin("GET", "http://test/api/settings"))).json();
      assert.deepEqual(viaApi.settings.homepage.imageFraming.guided_panel, CANON(tile));
    });

    test("carousel: a Khimar override and hero desktop/mobile crops round-trip (Shop Config → Carousel)", async () => {
      const heroDesktop = { mode: "fill", zoom: 1.4, x: 0.3, y: 0.2, w: 2560, h: 1120 };
      const heroMobile = { mode: "fill", zoom: 1, x: 0.5, y: 0.1, w: 2560, h: 1120 };
      const res = await putHomepage({
        carouselImages: { burqa: "", abaya: "", hijab: "", khimar: "https://example.test/khimar-hero.jpg" },
        imageFraming: { "hero_desktop:khimar": heroDesktop, "hero_mobile:khimar": heroMobile },
      });
      assert.equal(res.status, 200, await res.clone().text());
      const home = (await getSettings()).homepage;
      assert.equal(home.carouselImages.khimar, "https://example.test/khimar-hero.jpg");
      assert.deepEqual(home.imageFraming["hero_desktop:khimar"], CANON(heroDesktop));
      assert.deepEqual(home.imageFraming["hero_mobile:khimar"], CANON(heroMobile));
      // the strict schema still rejects an unknown department slot
      const bad = await putHomepage({ carouselImages: { niqab: "https://example.test/x.jpg" } });
      assert.equal(bad.status, 400);
    });

    test("a Stretch (free-resize) framing round-trips with its box, and Fill/Fit are unaffected", async () => {
      const stretched = { mode: "free", zoom: 1, x: 0.5, y: 0.5, w: 1200, h: 1600, bx: -0.05, by: 0, bw: 1.1, bh: 0.9 };
      const res = await putHomepage({ imageFraming: { "hero_desktop:hijab": stretched, "hero_mobile:hijab": tile } });
      assert.equal(res.status, 200, await res.clone().text());
      const map = (await getSettings()).homepage.imageFraming;
      assert.deepEqual(map["hero_desktop:hijab"], CANON(stretched));
      assert.equal(map["hero_desktop:hijab"].bw, 1.1);
      assert.equal("bx" in map["hero_mobile:hijab"], false, "a Fill crop stores no box");
      // A stretch framing missing its box is rejected, not silently stored as something else.
      const bad = await putHomepage({ imageFraming: { "hero_desktop:hijab": { ...stretched, bw: undefined } } });
      assert.equal(bad.status, 400);
    });

    test("keys must look like placements — arbitrary or hostile keys are rejected", async () => {
      for (const key of ["../../x", "__proto__", "banner.home", "Department_Tile", "a b", "department_tile:" + "x".repeat(60)]) {
        const res = await putHomepage({ imageFraming: { [key]: tile } });
        assert.equal(res.status, 400, key);
      }
    });

    test("an invalid crop value is rejected", async () => {
      const res = await putHomepage({ imageFraming: { banner_home: { ...banner, zoom: 12 } } });
      assert.equal(res.status, 400);
    });
  });

  describe("product photos (products.image_framing)", () => {
    const A = "https://example.test/front.jpg";
    const B = "https://example.test/back.jpg";
    const fit = { mode: "fit", zoom: 1, x: 0.5, y: 0.5, w: 1000, h: 1500 };
    const fill = { mode: "fill", zoom: 1.6, x: 0.3, y: 0.2, w: 1000, h: 1500 };
    let leaf;

    before(async () => {
      const parent = await createTestCategory();
      leaf = await Category.create({ name: "Framing leaf", slug: `framing-leaf-${Date.now()}`, parent: parent._id });
      madeCategories.push(parent._id, leaf._id);
    });

    async function createProduct(extra = {}) {
      const res = await productsPOST(
        await asAdmin("POST", "http://test/api/products", {
          name: "Framing product",
          description: "A test product for framing",
          category: String(leaf._id),
          basePrice: 1000,
          images: [A, B],
          variants: [{ variantName: "Default", sku: `FR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, stock: 5 }],
          ...extra,
        }),
      );
      return res;
    }

    test("per-photo framing round-trips, keyed by image URL", async () => {
      const res = await createProduct({ imageFraming: [entry(A, fill), entry(B, fit)] });
      assert.equal(res.status, 201, await res.clone().text());
      const { product } = await res.json();
      madeProducts.push(product._id);
      const reloaded = await Product.findById(product._id);
      assert.deepEqual(reloaded.imageFraming.find((e) => e.url === A).framing, CANON(fill));
      assert.deepEqual(reloaded.imageFraming.find((e) => e.url === B).framing, CANON(fit));
    });

    test("a product created without framing has none (renders as always)", async () => {
      const { product } = await (await createProduct()).json();
      madeProducts.push(product._id);
      assert.deepEqual((await Product.findById(product._id)).imageFraming, []);
    });

    test("framing for a URL that isn't one of the product's photos is dropped", async () => {
      const { product } = await (await createProduct({ imageFraming: [entry(A, fit), entry("https://example.test/not-used.jpg", fill)] })).json();
      madeProducts.push(product._id);
      assert.deepEqual((await Product.findById(product._id)).imageFraming.map((e) => e.url), [A]);
    });

    test("removing a photo removes its crop; editing other fields keeps the rest", async () => {
      const { product } = await (await createProduct({ imageFraming: [entry(A, fill), entry(B, fit)] })).json();
      madeProducts.push(product._id);

      let res = await productPUT(await asAdmin("PUT", `http://test/api/products/${product._id}`, { basePrice: 1200 }), { params: Promise.resolve({ idOrSlug: String(product._id) }) });
      assert.equal(res.status, 200);
      assert.equal((await Product.findById(product._id)).imageFraming.length, 2, "unrelated edit keeps both crops");

      res = await productPUT(await asAdmin("PUT", `http://test/api/products/${product._id}`, { images: [B] }), { params: Promise.resolve({ idOrSlug: String(product._id) }) });
      assert.equal(res.status, 200);
      assert.deepEqual((await Product.findById(product._id)).imageFraming.map((e) => e.url), [B], "the removed photo's crop is gone");
    });

    test("invalid product framing is rejected (400)", async () => {
      const res = await createProduct({ imageFraming: [entry(A, { ...fill, zoom: 50 })] });
      assert.equal(res.status, 400);
    });

    test("on a database WITHOUT migration 0006: a framed product save is refused (409); an unframed one is unaffected", async () => {
      const spy = mock.method(Product, "imageFramingInstalled", async () => false);
      try {
        const framed = await createProduct({ imageFraming: [entry(A, fit)] });
        assert.equal(framed.status, 409);
        const plain = await createProduct();
        assert.equal(plain.status, 201);
        madeProducts.push((await plain.json()).product._id);
      } finally {
        spy.mock.restore();
      }
    });
  });
});
