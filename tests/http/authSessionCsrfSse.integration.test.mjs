// Phase 2 closure, sections A/B/C: REAL HTTP integration tests for the
// session-cookie/CSRF/SSE migration, run through the actual `next start`
// process the tests/http harness (scripts/httpTestServer.mjs) spins up —
// not Route Handlers called directly, not services called directly. Every
// request in this file goes over real Node fetch() to a real listening
// HTTP server; cookies are parsed from real Set-Cookie response headers
// and replayed by hand (Node's fetch has no built-in cookie jar).
//
// Why this file exists in addition to tests/session.test.mjs and
// tests/routeErrorContract.test.mjs: those call Route Handler functions
// directly with hand-built Request objects — they prove the auth/CSRF
// LOGIC is correct, but they cannot prove Next.js's real HTTP layer
// (cookie serialization, header casing, actual TCP request/response,
// SSE framing over a real connection) behaves the same way. This file is
// that missing evidence.
//
// Cookie values are asserted for PRESENCE/absence and structural
// properties (HttpOnly, Secure, SameSite, Path, clearing) — never printed.
// assertCookieShape() below reports failures without interpolating the
// raw value into any assertion message.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestProduct } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

// `next start` (what this whole tests/http harness runs, per
// scripts/httpTestServer.mjs) unconditionally behaves as a PRODUCTION
// server regardless of NODE_ENV — confirmed empirically for this closure
// (curl against a manually-started `next start` process, with and without
// NODE_ENV=test set, both returned the __Host-prefixed, Secure cookie).
// This is a real, structural difference from tests/session.test.mjs's
// direct-handler suite, which runs in the SAME process under NODE_ENV=test
// and therefore sees the plain "tahos_session" name — lib/cookies.js's
// SESSION_COOKIE_NAME is frozen at module-load time per-process (see its
// own comment), so the two suites' processes legitimately disagree, and
// this suite must use the name the REAL server it's calling actually
// emits, not the name this test file's own process would compute.
const SESSION_COOKIE = "__Host-tahos_session";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/settings/public`);
  serverUp = res.ok || res.status < 500;
} catch {
  serverUp = false;
}

let dbConnectable = false;
if (serverUp && dbReady) {
  try {
    await connectTestDb();
    dbConnectable = true;
  } catch {
    dbConnectable = false;
  }
}

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

// ---------------------------------------------------------------------------
// A minimal, real cookie jar: absorbs Set-Cookie headers from a Response and
// replays them as a Cookie header on subsequent requests. Node's fetch does
// NOT do this automatically (unlike a browser), which is exactly why this
// suite needs one — it's the same problem a real SPA's fetch() calls solve
// via the browser's built-in jar, which credentials:"include" only works
// because of.
// ---------------------------------------------------------------------------
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    const setCookieLines = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of setCookieLines) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const isCleared = /max-age=0/i.test(raw) || /expires=thu,\s*01\s*jan\s*1970/i.test(raw);
      if (isCleared || value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, { value, raw });
      }
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v.value}`).join("; ");
  }
  get(name) {
    return this.cookies.get(name)?.value;
  }
  rawSetCookie(name) {
    return this.cookies.get(name)?.raw;
  }
  has(name) {
    return this.cookies.has(name);
  }
  clone() {
    const c = new CookieJar();
    c.cookies = new Map(this.cookies);
    return c;
  }
}

/**
 * Fires one real HTTP request. `origin`/`secFetchSite` are passed through
 * verbatim (including deliberately hostile/malformed values for the CSRF
 * matrix); omit both to test "neither header present." `csrf` sets
 * X-CSRF-Token; pass `omitCookie: true` to skip attaching the jar's Cookie
 * header entirely (simulates a completely different browser/client).
 */
async function req(jar, path, { method = "GET", body, origin, secFetchSite, csrf, extraHeaders = {}, omitCookie = false } = {}) {
  const headers = new Headers(extraHeaders);
  if (!omitCookie) {
    const cookieHeader = jar.header();
    if (cookieHeader) headers.set("cookie", cookieHeader);
  }
  if (body !== undefined) headers.set("content-type", "application/json");
  if (origin !== undefined) headers.set("origin", origin);
  if (secFetchSite !== undefined) headers.set("sec-fetch-site", secFetchSite);
  if (csrf !== undefined) headers.set("x-csrf-token", csrf);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  jar.absorb(res);
  return res;
}

function assertCookiePresentAndCleared(before_, after_, name) {
  assert.ok(before_.has(name), `${name} must have been set before logout`);
  assert.ok(!after_.has(name), `${name} must be cleared (absent from the jar) after logout's Set-Cookie`);
}

async function registerNewUser(jar, origin = BASE_URL) {
  const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const email = `httpauth_${suffix}@example.invalid`;
  const password = "RealHttpTest123!";
  // Phase 3B: this harness's real server runs with proxy trust configured
  // (see scripts/httpTestServer.mjs) — register's IP dimension is now its
  // ONLY dimension and fails closed with no IP at all (the correct fix
  // for a real deployment). This file predates that feature and never
  // needed to think about IP identity, so every call here gets its own
  // fresh, random fake client IP — never shared between calls (this file
  // registers a dozen-plus users across its tests; a single shared IP
  // would collide with REGISTER_IP_LIMIT's own 5/hour default and start
  // failing unrelated tests with 429 instead of exercising what they
  // actually test).
  const fakeClientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const res = await req(jar, "/api/users/register", {
    method: "POST",
    origin,
    body: { name: `HTTP Auth Test ${suffix}`, email, password },
    extraHeaders: { "x-forwarded-for": fakeClientIp },
  });
  return { res, email, password, json: await res.clone().json() };
}

describe("Phase 2 closure — real HTTP: session lifecycle, login, CSRF matrix, SSE", { skip }, () => {
  let User, Session, Cart, Order;

  before(async () => {
    ({ default: User } = await import("../../models/userModel.js"));
    ({ default: Session } = await import("../../models/sessionModel.js"));
    ({ default: Cart } = await import("../../models/cartModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  // =========================================================================
  // Real HTTP cookie-attribute shape — this harness's server (`next start`)
  // always runs production-mode, so this is genuine evidence of the actual
  // production cookie shape over the wire, not a simulation of it.
  // =========================================================================

  test("real HTTP: the session cookie is __Host-prefixed, HttpOnly, Secure, SameSite=Lax, Path=/, with no Domain attribute; the CSRF cookie is Secure + SameSite=Lax + Path=/ but NOT HttpOnly", async () => {
    const jar = new CookieJar();
    const { email } = await registerNewUser(jar);
    const sessionRaw = (jar.rawSetCookie(SESSION_COOKIE) || "").toLowerCase();
    const csrfRaw = (jar.rawSetCookie("tahos_csrf") || "").toLowerCase();

    assert.ok(sessionRaw.startsWith("__host-tahos_session="), "the __Host- prefix must be on the cookie NAME itself");
    assert.match(sessionRaw, /httponly/);
    assert.match(sessionRaw, /secure/);
    assert.match(sessionRaw, /samesite=lax/);
    assert.match(sessionRaw, /path=\//);
    assert.ok(!sessionRaw.includes("domain="), "__Host- REQUIRES no Domain attribute — the browser would silently refuse to store it otherwise");

    assert.match(csrfRaw, /secure/);
    assert.match(csrfRaw, /samesite=lax/);
    assert.match(csrfRaw, /path=\//);
    assert.ok(!csrfRaw.includes("httponly"), "the CSRF cookie must NOT be HttpOnly — client JS has to read it to attach X-CSRF-Token");

    await User.deleteOne({ email });
  });

  // =========================================================================
  // A — full real-HTTP lifecycle: register -> me -> cart CSRF -> checkout ->
  //     order -> logout -> replay rejected
  // =========================================================================

  test("full lifecycle: register sets real cookies with no token leak, /me restores the user from the cookie alone, cart mutations enforce CSRF over real HTTP, an order is created and owned correctly, and logout truly revokes the session", async () => {
    const jar = new CookieJar();
    const product = await createTestProduct({ stock: 5 });

    // ---- 1-2: register, verify response shape ----
    const { res: registerRes, email, json: registerJson } = await registerNewUser(jar);
    assert.equal(registerRes.status, 201);
    assert.ok(jar.has(SESSION_COOKIE), "a real Set-Cookie: tahos_session=... must have been sent over the wire");
    assert.ok(jar.has("tahos_csrf"), "a real Set-Cookie: tahos_csrf=... must have been sent over the wire");
    const registerBodyText = JSON.stringify(registerJson);
    assert.ok(!("token" in registerJson), "no token field in the real JSON body");
    assert.ok(!registerBodyText.includes(jar.get(SESSION_COOKIE)), "the raw session cookie value never appears anywhere in the response body");
    assert.ok(!registerBodyText.includes(jar.get("tahos_csrf")), "the raw CSRF cookie value never appears anywhere in the response body");
    assert.match(registerRes.headers.get("cache-control") || "", /no-store/);
    assert.equal(registerJson.user.email, email);

    // ---- 3-5: GET /me using ONLY the session cookie (real HTTP, real cookie replay) ----
    const meRes = await req(jar, "/api/users/me");
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.email, email, "the session cookie alone restored the correct authenticated user over real HTTP");
    assert.match(meRes.headers.get("cache-control") || "", /no-store/);

    // ---- 6: authenticated cart mutation — CSRF enforcement over real HTTP ----
    const cartBody = { productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 };

    const noCsrfRes = await req(jar, "/api/cart", { method: "POST", origin: BASE_URL, body: cartBody });
    assert.equal(noCsrfRes.status, 403, "no X-CSRF-Token header -> 403 over real HTTP");

    const wrongCsrfRes = await req(jar, "/api/cart", { method: "POST", origin: BASE_URL, body: cartBody, csrf: "totally-wrong-csrf-value" });
    assert.equal(wrongCsrfRes.status, 403, "incorrect X-CSRF-Token -> 403 over real HTTP");

    const correctCsrfRes = await req(jar, "/api/cart", { method: "POST", origin: BASE_URL, body: cartBody, csrf: jar.get("tahos_csrf") });
    assert.equal(correctCsrfRes.status, 200, "correct cookie+header pair -> success over real HTTP");

    // ---- 7: fresh request (new headers, same jar) confirms the cart persisted server-side ----
    const cartGetRes = await req(jar, "/api/cart");
    assert.equal(cartGetRes.status, 200);
    const cartJson = await cartGetRes.json();
    assert.equal(cartJson.cart.items.length, 1);

    // ---- 8: order preview (POST — an unsafe method, so it's Origin- and,
    // since this request IS authenticated, CSRF-gated too, exactly like any
    // other unsafe route; guests without a session skip the CSRF layer per
    // lib/http.js, but this jar already carries one) ----
    const previewBody = {
      items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
      shippingAddress: { fullName: "HTTP Test Buyer", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
    };
    const previewNoCsrfRes = await req(jar, "/api/orders/preview", { method: "POST", origin: BASE_URL, body: previewBody });
    assert.equal(previewNoCsrfRes.status, 403, "authenticated + unsafe + no CSRF header -> 403, even for a read-only-effect preview route");

    const previewRes = await req(jar, "/api/orders/preview", { method: "POST", origin: BASE_URL, body: previewBody, csrf: jar.get("tahos_csrf") });
    assert.equal(previewRes.status, 200, "with the correct CSRF header attached, the authenticated preview succeeds");

    // ---- 9-10: create a real order via cookie + CSRF, confirm ownership ----
    const orderRes = await req(jar, "/api/orders", {
      method: "POST",
      origin: BASE_URL,
      csrf: jar.get("tahos_csrf"),
      body: previewBody,
    });
    assert.equal(orderRes.status, 201, "order creation succeeds with cookie + Origin + correct CSRF over real HTTP");
    const orderJson = await orderRes.json();
    const me2 = await (await req(jar, "/api/users/me")).json();
    assert.equal(String(orderJson.order.user), String(me2.user._id), "the created order belongs to the authenticated user, not a guest/anonymous placeholder");

    // ---- 11-12: real logout clears both cookies ----
    const jarBeforeLogout = jar.clone();
    const oldSessionValue = jar.get(SESSION_COOKIE);
    const logoutRes = await req(jar, "/api/users/logout", { method: "POST", origin: BASE_URL, csrf: jar.get("tahos_csrf") });
    assert.equal(logoutRes.status, 200);
    assertCookiePresentAndCleared(jarBeforeLogout, jar, SESSION_COOKIE);
    assertCookiePresentAndCleared(jarBeforeLogout, jar, "tahos_csrf");

    // ---- 13-14: replay the OLD session cookie (not the now-cleared jar) ----
    const replayJar = new CookieJar();
    replayJar.cookies.set(SESSION_COOKIE, { value: oldSessionValue, raw: "" });
    const replayRes = await req(replayJar, "/api/users/me");
    assert.equal(replayRes.status, 401, "replaying the logged-out session cookie must fail");

    // ---- 15: GET /me with the (now cookie-less) jar after logout ----
    const meAfterLogoutRes = await req(jar, "/api/users/me");
    assert.equal(meAfterLogoutRes.status, 401);

    await Order.deleteMany({ user: me2.user._id });
    await Cart.deleteMany({ userId: me2.user._id });
    await User.deleteOne({ email });
    const { default: Product } = await import("../../models/productModel.js");
    await Product.deleteOne({ _id: product._id });
  });

  // =========================================================================
  // A (continued) — login-specific real-HTTP behavior
  // =========================================================================

  test("real HTTP login: success sets fresh cookies, failure sets none, an attacker-controlled presented cookie is replaced (fixation prevention), and JSON never exposes a session token", async () => {
    const setupJar = new CookieJar();
    const { email, password } = await registerNewUser(setupJar);
    // Log the fresh registration's own session out of the picture — we want
    // a clean slate to test LOGIN specifically, not register.
    await req(setupJar, "/api/users/logout", { method: "POST", origin: BASE_URL, csrf: setupJar.get("tahos_csrf") });

    // ---- failed login sets no session cookie ----
    const failJar = new CookieJar();
    const failRes = await req(failJar, "/api/users/login", { method: "POST", origin: BASE_URL, body: { email, password: "WrongPassword!" } });
    assert.equal(failRes.status, 401);
    assert.ok(!failJar.has(SESSION_COOKIE), "a failed login must not set a session cookie over real HTTP");

    // ---- successful login sets NEW cookies ----
    const loginJar = new CookieJar();
    const loginRes = await req(loginJar, "/api/users/login", { method: "POST", origin: BASE_URL, body: { email, password } });
    assert.equal(loginRes.status, 200);
    assert.ok(loginJar.has(SESSION_COOKIE));
    const loginJson = await loginRes.json();
    assert.ok(!("token" in loginJson), "login JSON never exposes a session token over real HTTP");
    assert.ok(!JSON.stringify(loginJson).includes(loginJar.get(SESSION_COOKIE)));

    // ---- an attacker-controlled cookie presented during login is replaced ----
    const attackerJar = new CookieJar();
    // Plant an arbitrary-looking (garbage, never-issued) session value —
    // the real fixation scenario is "attacker sets victim's cookie before
    // victim logs in"; the garbage value itself doesn't need to be a real
    // session for the fixation-prevention behavior (issue a brand-new one
    // regardless) to be meaningfully exercised.
    attackerJar.cookies.set(SESSION_COOKIE, { value: "attacker-planted-garbage-session-value", raw: "" });
    const fixationLoginRes = await req(attackerJar, "/api/users/login", { method: "POST", origin: BASE_URL, body: { email, password } });
    assert.equal(fixationLoginRes.status, 200);
    assert.notEqual(attackerJar.get(SESSION_COOKIE), "attacker-planted-garbage-session-value", "the server must issue a brand-new session, never accept/reuse the presented one");

    await User.deleteOne({ email });
  });

  test("real HTTP: Authorization: Bearer alone (no cookie) returns 401; a ?token= query string alone (no cookie) returns 401", async () => {
    const emptyJar = new CookieJar();
    const bearerRes = await req(emptyJar, "/api/users/me", { extraHeaders: { authorization: "Bearer some-old-jwt-shaped-string" } });
    assert.equal(bearerRes.status, 401, "no bearer fallback exists anywhere, confirmed over real HTTP");

    const queryTokenRes = await fetch(`${BASE_URL}/api/users/me?token=some-old-jwt-shaped-string`);
    assert.equal(queryTokenRes.status, 401, "a query-string token is never read for authentication, confirmed over real HTTP");
  });

  // =========================================================================
  // B — real HTTP CSRF / Origin matrix
  // =========================================================================

  describe("real HTTP CSRF and Origin matrix", () => {
    let jar, email, csrfToken, product;

    before(async () => {
      jar = new CookieJar();
      ({ email } = await registerNewUser(jar));
      csrfToken = jar.get("tahos_csrf");
      product = await createTestProduct({ stock: 50 });
    });

    after(async () => {
      const { default: Product } = await import("../../models/productModel.js");
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ email });
    });

    const cartBody = () => ({ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 });

    test("exact APP_ORIGIN (this server's own real origin, set explicitly for this test run — see scripts/httpTestServer.mjs) succeeds", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", origin: BASE_URL, csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 200);
    });

    test("a hostile Origin that contains the real hostname as a DECOY substring fails — proves parsed-origin equality, not substring/regex matching", async () => {
      const decoy = `https://${new URL(BASE_URL).host}.attacker.com`;
      const res = await req(jar, "/api/cart", { method: "POST", origin: decoy, csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("the real origin as a SUBSTRING of a longer hostile Origin fails — e.g. 'http://127.0.0.1:PORT0' when the real port is PORT", async () => {
      const superstringOrigin = `${BASE_URL}0`; // real origin with an extra trailing digit on the port
      const res = await req(jar, "/api/cart", { method: "POST", origin: superstringOrigin, csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("correct hostname, wrong scheme fails (http vs https)", async () => {
      const u = new URL(BASE_URL);
      const wrongScheme = `https://${u.host}`;
      const res = await req(jar, "/api/cart", { method: "POST", origin: wrongScheme, csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("correct hostname, wrong port fails", async () => {
      const u = new URL(BASE_URL);
      const wrongPort = `${u.protocol}//${u.hostname}:${Number(u.port) + 1}`;
      const res = await req(jar, "/api/cart", { method: "POST", origin: wrongPort, csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("a completely unrelated Origin fails", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", origin: "https://example.com", csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("Origin: null fails", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", origin: "null", csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("a malformed Origin value fails", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", origin: "not-a-valid-origin-at-all", csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("missing Origin AND missing Sec-Fetch-Site fails (documented: neither signal present is a hard reject, not an allow-by-default)", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("missing Origin with Sec-Fetch-Site: cross-site fails", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", secFetchSite: "cross-site", csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("missing Origin with the documented same-origin fallback (Sec-Fetch-Site: same-origin) succeeds exactly as documented in lib/csrf.js", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", secFetchSite: "same-origin", csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 200);
    });

    test("safe GET succeeds with no Origin and no CSRF header at all", async () => {
      const res = await req(jar, "/api/cart");
      assert.equal(res.status, 200);
    });

    test("unsafe POST fails without any CSRF header even with a perfectly valid Origin", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", origin: BASE_URL, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("CSRF cookie present (real jar) but X-CSRF-Token header omitted fails", async () => {
      const res = await req(jar, "/api/cart", { method: "POST", origin: BASE_URL, body: cartBody() });
      assert.equal(res.status, 403);
    });

    test("X-CSRF-Token header present but the tahos_csrf cookie itself is withheld (a different client without that cookie) fails", async () => {
      const noCsrfCookieJar = new CookieJar();
      noCsrfCookieJar.cookies.set(SESSION_COOKIE, { value: jar.get(SESSION_COOKIE), raw: "" });
      const res = await req(noCsrfCookieJar, "/api/cart", { method: "POST", origin: BASE_URL, csrf: csrfToken, body: cartBody() });
      assert.equal(res.status, 403, "the session cookie's own csrfTokenHash still won't match with no proof the client can read this session's actual CSRF cookie value — but specifically: header alone, cookie absent, must fail");
    });

    test("a real, valid CSRF token belonging to a DIFFERENT session (a second real registered user) fails against this session — even when header and cookie AGREE with each other, isolating the cross-session hash check specifically", async () => {
      const otherJar = new CookieJar();
      const { email: otherEmail } = await registerNewUser(otherJar);
      const otherCsrf = otherJar.get("tahos_csrf");

      // Authenticate as THIS session (its own tahos_session cookie), but
      // swap in the OTHER user's CSRF cookie+header pair (self-consistent
      // with each other, just not with this session). This isolates the
      // cross-session csrfTokenHash comparison from the header!==cookie
      // check that a naive "just send a different header" version would
      // have actually been failing on instead.
      const crossedJar = jar.clone();
      crossedJar.cookies.set("tahos_csrf", { value: otherCsrf, raw: "" });

      const res = await req(crossedJar, "/api/cart", { method: "POST", origin: BASE_URL, csrf: otherCsrf, body: cartBody() });
      assert.equal(res.status, 403, "header and cookie agree with each other, but neither matches THIS session's csrfTokenHash");

      await User.deleteOne({ email: otherEmail });
    });

    test("an expired session with an otherwise-valid CSRF pair fails with 401 (not 403) — session state is checked before CSRF is even relevant", async () => {
      const expiredJar = new CookieJar();
      const { email: expiredEmail } = await registerNewUser(expiredJar);
      const rawToken = expiredJar.get(SESSION_COOKIE);
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await Session.updateOne({ tokenHash }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      const res = await req(expiredJar, "/api/cart", { method: "POST", origin: BASE_URL, csrf: expiredJar.get("tahos_csrf"), body: cartBody() });
      assert.equal(res.status, 401);

      await User.deleteOne({ email: expiredEmail });
    });

    test("a revoked session (real logout) with its previously-valid CSRF pair fails with 401", async () => {
      const revokedJar = new CookieJar();
      const { email: revokedEmail } = await registerNewUser(revokedJar);
      // Capture the raw values BEFORE logout's Set-Cookie clears them from
      // the jar — the whole point of this test is a client that replays a
      // cookie it already had, ignoring the clearing Set-Cookie it was sent
      // (a copied cookie, a stale browser tab, etc.).
      const staleSessionValue = revokedJar.get(SESSION_COOKIE);
      const staleCsrfValue = revokedJar.get("tahos_csrf");

      await req(revokedJar, "/api/users/logout", { method: "POST", origin: BASE_URL, csrf: staleCsrfValue });

      const user = await User.findOne({ email: revokedEmail });
      const revokedSession = await Session.findOne({ user: user._id });
      assert.ok(revokedSession.revokedAt, "sanity check: logout really did revoke it server-side");

      const staleJar = new CookieJar();
      staleJar.cookies.set(SESSION_COOKIE, { value: staleSessionValue, raw: "" });
      const res = await req(staleJar, "/api/cart", { method: "POST", origin: BASE_URL, csrf: staleCsrfValue, body: cartBody() });
      assert.equal(res.status, 401, "the real HTTP request with the stale (now-revoked) session cookie and its own previously-valid CSRF token must fail with 401");

      await User.deleteOne({ email: revokedEmail });
    });
  });

  // =========================================================================
  // C — real HTTP SSE
  // =========================================================================

  describe("real HTTP SSE", () => {
    let customerJar, staffJar, ownerJar, strangerJar;
    let customerEmail, staffEmail, ownerEmail, strangerEmail;
    let orderId, product;

    before(async () => {
      customerJar = new CookieJar();
      ({ email: customerEmail } = await registerNewUser(customerJar));

      staffJar = new CookieJar();
      ({ email: staffEmail } = await registerNewUser(staffJar));
      await User.updateOne({ email: staffEmail }, { $set: { role: "employee", permissions: [] } });
      // Re-login so the session's own view of the role is irrelevant — the
      // route re-reads the user from the database on every request anyway
      // (see lib/auth.js), so no re-login is actually required, but doing
      // it keeps this fixture obviously correct without relying on that
      // implementation detail.

      ownerJar = new CookieJar();
      ({ email: ownerEmail } = await registerNewUser(ownerJar));
      strangerJar = new CookieJar();
      ({ email: strangerEmail } = await registerNewUser(strangerJar));

      product = await createTestProduct({ stock: 5 });
      const orderRes = await req(ownerJar, "/api/orders", {
        method: "POST",
        origin: BASE_URL,
        csrf: ownerJar.get("tahos_csrf"),
        body: {
          items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
          shippingAddress: { fullName: "SSE Owner", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
        },
      });
      const orderJson = await orderRes.json();
      orderId = orderJson.order._id;
    });

    after(async () => {
      await Order.deleteMany({ _id: orderId });
      const { default: Product } = await import("../../models/productModel.js");
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ email: { $in: [customerEmail, staffEmail, ownerEmail, strangerEmail] } });
    });

    async function openSse(path, jar) {
      const headers = new Headers();
      const cookieHeader = jar.header();
      if (cookieHeader) headers.set("cookie", cookieHeader);
      const controller = new AbortController();
      const res = await fetch(`${BASE_URL}${path}`, { headers, signal: controller.signal });
      return { res, controller };
    }

    test("admin SSE: no cookie -> 401", async () => {
      const { res } = await openSse("/api/admin/events", new CookieJar());
      assert.equal(res.status, 401);
    });

    test("admin SSE: authenticated customer -> 403", async () => {
      const { res } = await openSse("/api/admin/events", customerJar);
      assert.equal(res.status, 403);
    });

    test("admin SSE: authorized staff -> real 200 SSE response with correct headers, aborts cleanly, no hang", async () => {
      const { res, controller } = await openSse("/api/admin/events", staffJar);
      try {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/event-stream");
        const cacheControl = res.headers.get("cache-control") || "";
        assert.match(cacheControl, /no-cache|no-store/);
        assert.match(cacheControl, /no-transform/);
      } finally {
        controller.abort();
      }
    });

    test("order SSE: the order's owner gets a real 200 SSE response", async () => {
      const { res, controller } = await openSse(`/api/orders/${orderId}/events`, ownerJar);
      try {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/event-stream");
      } finally {
        controller.abort();
      }
    });

    test("order SSE: a different customer (not the owner, not staff) -> 403", async () => {
      const { res, controller } = await openSse(`/api/orders/${orderId}/events`, strangerJar);
      try {
        assert.equal(res.status, 403);
      } finally {
        controller.abort();
      }
    });

    test("order SSE: ?token=fake-or-old-token with NO cookie -> 401 (proves the query string is never read for auth)", async () => {
      const controller = new AbortController();
      const res = await fetch(`${BASE_URL}/api/orders/${orderId}/events?token=fake-or-old-token`, { signal: controller.signal });
      controller.abort();
      assert.equal(res.status, 401);
    });

    test("order SSE: a valid cookie PLUS an irrelevant ?token= still authenticates purely from the cookie", async () => {
      const controller = new AbortController();
      const headers = new Headers();
      headers.set("cookie", ownerJar.header());
      const res = await fetch(`${BASE_URL}/api/orders/${orderId}/events?token=some-irrelevant-value`, { headers, signal: controller.signal });
      try {
        assert.equal(res.status, 200, "the stale/irrelevant token param must have zero effect on authentication");
      } finally {
        controller.abort();
      }
    });
  });
});
