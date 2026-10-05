// A store's website is called what the store is called. Until its owner types a name under Storefront → Settings, that is the
// organization's own name — never another shop's ("TAHOS."), never the database's "My Store" placeholder.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, truncateAll, rawQuery } from "./helpers/testDb.mjs";
import { resolveStoreName, PLACEHOLDER_STORE_NAME } from "../lib/storeName.js";

describe("resolveStoreName", () => {
  test("a name the owner typed wins", () => {
    assert.equal(resolveStoreName("Rakib Fashion", "Rakib Fashion House"), "Rakib Fashion");
  });
  test("the column's placeholder, or nothing, means the organization's name", () => {
    assert.equal(resolveStoreName(PLACEHOLDER_STORE_NAME, "Rakib Fashion House"), "Rakib Fashion House");
    assert.equal(resolveStoreName("", "Rakib Fashion House"), "Rakib Fashion House");
    assert.equal(resolveStoreName("   ", "Rakib Fashion House"), "Rakib Fashion House");
    assert.equal(resolveStoreName(null, "Rakib Fashion House"), "Rakib Fashion House");
  });
  test("with no organization name either, what there is stays", () => {
    assert.equal(resolveStoreName(PLACEHOLDER_STORE_NAME, ""), PLACEHOLDER_STORE_NAME);
    assert.equal(resolveStoreName("", ""), "");
  });
});

describe("no other shop's brand is baked into the storefront", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  test("the header, footer, error page, page titles and reset email carry no literal TAHOS fallback", () => {
    for (const f of ["components/layout/Header.jsx", "components/layout/Footer.jsx", "app/global-error.jsx", "app/layout.js", "utlis/sendEmail.js", "models/themeModel.js"]) {
      const code = read(f).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
      assert.ok(!/TAHOS/.test(code), `${f} still names TAHOS`);
    }
    assert.ok(!/TAHOS/.test(read("lib/i18n/dictionaries/en.js").match(/seo: \{[\s\S]*?defaultTitle: "([^"]*)"/)[1]));
  });
});

describe("a store's settings take the organization's name", { skip: !dbReady && skipReason }, () => {
  let Settings;
  let organizationName;
  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ default: Settings } = await import("../models/settingsModel.js"));
    organizationName = (await rawQuery("SELECT name FROM organizations WHERE id = ?", [process.env.STORE_ORGANIZATION_ID]))[0]?.name;
  });
  after(async () => {
    await disconnectTestDb();
  });

  test("a store with no settings row is created with its organization's name", async () => {
    await rawQuery("DELETE FROM store_settings WHERE organization_id = ?", [process.env.STORE_ORGANIZATION_ID]);
    const settings = await Settings.getSingleton();
    assert.ok(organizationName, "the test organization has a name");
    assert.equal(settings.store.name, organizationName);
    const [row] = await rawQuery("SELECT store_name FROM store_settings WHERE organization_id = ?", [process.env.STORE_ORGANIZATION_ID]);
    assert.equal(row.store_name, organizationName);
  });

  test("a row still holding the placeholder reads as the organization's name; a typed name is kept", async () => {
    await rawQuery("UPDATE store_settings SET store_name = ? WHERE organization_id = ?", [PLACEHOLDER_STORE_NAME, process.env.STORE_ORGANIZATION_ID]);
    assert.equal((await Settings.getSingleton()).store.name, organizationName);
    await rawQuery("UPDATE store_settings SET store_name = 'Rakib Fashion' WHERE organization_id = ?", [process.env.STORE_ORGANIZATION_ID]);
    assert.equal((await Settings.getSingleton()).store.name, "Rakib Fashion");
  });
});
