// Phase 5B — validation for the previously-deferred admin route families:
// categories, attributes, themes, settings, analytics ranges, and upload
// folder metadata.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestSession, requestAs, createTestUser } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Phase 5B — deferred route family validation", { skip: !canRun && reason }, () => {
  let categoriesPOST, categoryPUT;
  let attributesPOST;
  let themePOST, themePUT;
  let settingsPUT;
  let salesSeriesGET, topProductsGET;
  let Category, AttributeDefinition, Theme, Settings, User;

  before(async () => {
    await connectTestDb();
    ({ POST: categoriesPOST } = await import("../app/api/categories/route.js"));
    ({ PUT: categoryPUT } = await import("../app/api/categories/[id]/route.js"));
    ({ POST: attributesPOST } = await import("../app/api/attributes/route.js"));
    ({ POST: themePOST } = await import("../app/api/theme/route.js"));
    ({ PUT: themePUT } = await import("../app/api/theme/[id]/route.js"));
    ({ PUT: settingsPUT } = await import("../app/api/settings/route.js"));
    ({ GET: salesSeriesGET } = await import("../app/api/analytics/sales-series/route.js"));
    ({ GET: topProductsGET } = await import("../app/api/analytics/top-products/route.js"));
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ default: Theme } = await import("../models/themeModel.js"));
    ({ default: Settings } = await import("../models/settingsModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  async function adminReq(admin, method, url, body) {
    return requestAs({ method, url, session: await createTestSession(admin._id), body });
  }

  test("categories: a valid department succeeds (201)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await categoriesPOST(await adminReq(admin, "POST", "http://test/api/categories", { name: "Test Dept" }));
      assert.equal(res.status, 201);
      const { category } = await res.json();
      await Category.deleteOne({ _id: category._id });
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("categories: an unknown field is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await categoriesPOST(await adminReq(admin, "POST", "http://test/api/categories", { name: "X", notReal: 1 }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("categories: a malformed parent id is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await categoriesPOST(await adminReq(admin, "POST", "http://test/api/categories", { name: "X", parent: "not-an-id" }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("categories: PUT with a malformed id -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await categoryPUT(await adminReq(admin, "PUT", "http://test/api/categories/not-a-valid-id", { name: "X" }), { params: Promise.resolve({ id: "not-a-valid-id" }) });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("attributes: a Mongo-operator-shaped key is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await attributesPOST(await adminReq(admin, "POST", "http://test/api/attributes", { key: "color", label: "Color", options: { $gt: "" } }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("attributes: a valid attribute succeeds (201)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await attributesPOST(
        await adminReq(admin, "POST", "http://test/api/attributes", {
          key: `color-${Date.now()}`,
          label: "Color",
          options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }],
        }),
      );
      assert.equal(res.status, 201);
      const { attribute } = await res.json();
      await AttributeDefinition.deleteOne({ _id: attribute._id });
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("theme: an invalid shadowStyle enum value is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await themePOST(await adminReq(admin, "POST", "http://test/api/theme", { name: "Test Theme", shadowStyle: "extreme" }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("theme: a valid theme succeeds (201), and PUT with an unknown field is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    let theme;
    try {
      const res = await themePOST(await adminReq(admin, "POST", "http://test/api/theme", { name: "Test Theme", colors: { primary: "#111111" } }));
      assert.equal(res.status, 201);
      theme = (await res.json()).theme;

      const badRes = await themePUT(await adminReq(admin, "PUT", `http://test/api/theme/${theme._id}`, { notAField: true }), { params: Promise.resolve({ id: theme._id }) });
      assert.equal(badRes.status, 400);
    } finally {
      if (theme) await Theme.deleteOne({ _id: theme._id });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("settings: a tax rate above 1 is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await settingsPUT(await adminReq(admin, "PUT", "http://test/api/settings", { taxRules: [{ region: "BD", rate: 1.5 }] }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("settings: a negative shipping baseCost is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await settingsPUT(
        await adminReq(admin, "PUT", "http://test/api/settings", { shippingZones: [{ region: "BD", currency: "BDT", tiers: [{ name: "x", baseCost: -1 }] }] }),
      );
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("settings: an empty body is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await settingsPUT(await adminReq(admin, "PUT", "http://test/api/settings", {}));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("settings: a valid partial update succeeds (200)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await settingsPUT(await adminReq(admin, "PUT", "http://test/api/settings", { promotions: { firstOrderFreeShipping: true } }));
      assert.equal(res.status, 200);
      const settings = await Settings.getSingleton();
      assert.equal(settings.promotions.firstOrderFreeShipping, true);
      settings.promotions.firstOrderFreeShipping = false;
      await settings.save();
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("analytics: sales-series days=999999 is rejected (400), not an unbounded aggregation", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await salesSeriesGET(requestAs({ method: "GET", url: "http://test/api/analytics/sales-series?days=999999", session: await createTestSession(admin._id) }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("analytics: top-products limit=abc is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await topProductsGET(requestAs({ method: "GET", url: "http://test/api/analytics/top-products?limit=abc", session: await createTestSession(admin._id) }));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("upload: a path-traversal-shaped folder value is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const { POST: uploadPOST } = await import("../app/api/upload/route.js");
      const fd = new FormData();
      const pngBytes = new Uint8Array(64).fill(0x2a);
      pngBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      fd.append("image", new File([pngBytes], "photo.png", { type: "image/png" }));
      const session = await createTestSession(admin._id);
      const req = new Request("http://test/api/upload?folder=..%2F..%2Fetc", {
        method: "POST",
        headers: { cookie: `tahos_session=${session.rawToken}; tahos_csrf=${session.rawCsrfToken}`, "x-csrf-token": session.rawCsrfToken, origin: "http://test" },
        body: fd,
      });
      const res = await uploadPOST(req);
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });
});
