// A real shopper in a real browser: register, find a product, add it to the
// cart, check out with cash on delivery, and see the order.
//
// Every other suite calls routes directly. This one drives the built pages in
// headless Chromium, so it also catches what those cannot: a page that no
// longer hydrates, a button wired to the wrong handler, a Content-Security-
// Policy that blocks a script, a client-side exception. Any of those fails
// the test, not just a wrong total.
//
// Runs under scripts/httpTestServer.mjs (npm run test:http), which builds the
// app, seeds the test database and starts it on HTTP_TEST_BASE_URL.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestProduct, rawQuery } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  serverUp = (await fetch(`${BASE_URL}/api/settings/public`)).status < 500;
} catch {
  serverUp = false;
}

const skip = !serverUp ? `no server at ${BASE_URL}` : !dbReady ? skipReason : false;

describe("a shopper's first order, in a real browser", { skip }, () => {
  let browser, page, product;
  const problems = [];
  const email = `shopper-${crypto.randomBytes(4).toString("hex")}@example.test`;
  const password = "Shopper-Journey-9!";

  before(async () => {
    await connectTestDb();
    product = await createTestProduct({ stock: 25, basePrice: 1500 });
    browser = await chromium.launch();
    // A store's default language may be Bangla; this shopper picks English,
    // the same cookie the language switcher writes (lib/i18n/config.js).
    const context = await browser.newContext();
    await context.addCookies([{ name: "tahos_locale", value: "en-BD", url: BASE_URL }]);
    page = await context.newPage();
    // Anything the browser itself complains about is a failure of the page.
    page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !/Failed to load resource: the server responded with a status of 4\d\d/.test(msg.text())) {
        problems.push(`console error: ${msg.text()}`);
      }
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        console.error(`CSP blocked ${e.blockedURI || "inline"} (${e.violatedDirective})`);
      });
    });
  });

  after(async () => {
    await browser?.close();
    await disconnectTestDb();
  });

  test("registers an account", async () => {
    await page.goto(`${BASE_URL}/register`);
    await page.getByLabel("Name", { exact: true }).fill("Journey Shopper");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/register"), { timeout: 15_000 });

    const [customer] = await rawQuery("SELECT id FROM customers WHERE email = ?", [email]);
    assert.ok(customer, "the account exists");
  });

  test("adds the product to the cart from its page", async () => {
    await page.goto(`${BASE_URL}/product/${product._id}`);
    // Listen before clicking: a fast response can otherwise arrive before
    // the wait starts, and the wait then times out on a cart that worked.
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/cart") && res.request().method() === "POST" && res.ok(), { timeout: 15_000 }),
      page.getByRole("button", { name: "Add to Cart" }).first().click(),
    ]);
  });

  test("checks out with cash on delivery and lands on the order", async () => {
    await page.goto(`${BASE_URL}/cart`);
    await page.getByRole("button", { name: "Checkout", exact: true }).click();
    await page.waitForURL(/\/checkout/, { timeout: 15_000 });

    // A first order: with no saved address, checkout opens the address form
    // itself (a returning shopper would press "+ Add new address" instead).
    // The button can show for a moment before the form replaces it, so wait
    // for the form first and press the button only if it never opens.
    const fullName = page.getByLabel("Full name");
    const formOpened = await fullName.waitFor({ timeout: 5_000 }).then(() => true, () => false);
    if (!formOpened) await page.getByRole("button", { name: "+ Add new address" }).click();
    await fullName.fill("Journey Shopper");
    await page.getByLabel("Phone").fill("01700000000");
    await page.getByLabel("Street").fill("1 Test Road");
    await page.getByLabel("City").fill("Dhaka");
    await page.getByLabel("Postal code").fill("1207");
    await page.getByLabel("Country").fill("Bangladesh");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/addresses") && res.request().method() === "POST" && res.ok(), { timeout: 15_000 }),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);

    await page.getByText("Cash on delivery", { exact: true }).click();
    await page.getByRole("button", { name: /^Place order/ }).click();
    await page.waitForURL(/\/order-success\//, { timeout: 30_000 });

    const orderId = new URL(page.url()).pathname.split("/").pop();
    const [order] = await rawQuery(
      `SELECT o.status, o.total, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
      [orderId],
    );
    assert.ok(order, "the order the page shows exists");
    assert.equal(order.email, email, "and belongs to this shopper");
    // Cash on delivery is confirmed as part of checkout (paymentService.codCreate).
    assert.equal(order.status, "processing");
    assert.ok(Number(order.total) >= 1500, `the total includes the product (${order.total})`);
  });

  test("sees the order in their account", async () => {
    await page.goto(`${BASE_URL}/orders`);
    await page.waitForLoadState("networkidle");
    const [{ n }] = await rawQuery("SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.email = ?", [email]);
    assert.equal(Number(n), 1);
    assert.ok(await page.getByText(/pending|order placed|processing/i).first().isVisible(), "the orders page lists it");
  });

  test("no page errors, console errors or CSP violations along the way", () => {
    assert.deepEqual(problems, []);
  });
});
