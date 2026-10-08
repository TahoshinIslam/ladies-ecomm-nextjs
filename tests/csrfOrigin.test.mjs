// Layer 1 of the CSRF defence: an unsafe request's Origin must be the app's own origin.
//
// In local development `next dev` reports every request's URL as http://localhost:<port> whatever address the browser used, so opening
// the store as 127.0.0.1 or by the machine's LAN address made every login and registration "Cross-origin request rejected". Development
// now accepts an Origin equal to the Host the browser reached — but only for `localhost` and IP addresses, never a domain name, and
// never in production. These tests pin both halves: what now works, and what must still be refused.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { validateOrigin } from "../lib/csrf.js";

const saved = { NODE_ENV: process.env.NODE_ENV, APP_ORIGIN: process.env.APP_ORIGIN };
beforeEach(() => { delete process.env.APP_ORIGIN; });
afterEach(() => {
  process.env.NODE_ENV = saved.NODE_ENV;
  if (saved.APP_ORIGIN === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = saved.APP_ORIGIN;
});

// `next dev` hands the handler a URL that says localhost; the browser's Origin and the Host header say what was really typed.
const post = ({ origin, host, secFetchSite, url = "http://localhost:3100/api/users/login" }) => {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (host) headers.set("host", host);
  if (secFetchSite) headers.set("sec-fetch-site", secFetchSite);
  return new Request(url, { method: "POST", headers });
};

describe("development (next dev)", () => {
  beforeEach(() => { process.env.NODE_ENV = "development"; });

  test("localhost is accepted, as before", () => {
    assert.equal(validateOrigin(post({ origin: "http://localhost:3100", host: "localhost:3100" })), true);
  });
  test("127.0.0.1 is accepted — the case that used to fail", () => {
    assert.equal(validateOrigin(post({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" })), true);
  });
  test("the machine's LAN address is accepted", () => {
    assert.equal(validateOrigin(post({ origin: "http://192.168.68.77:3100", host: "192.168.68.77:3100" })), true);
  });
  test("an IPv6 loopback is accepted", () => {
    assert.equal(validateOrigin(post({ origin: "http://[::1]:3100", host: "[::1]:3100" })), true);
  });
  test("another site's Origin is refused", () => {
    assert.equal(validateOrigin(post({ origin: "https://evil.example", host: "localhost:3100" })), false);
  });
  test("an Origin that is not the address the server was reached on is refused", () => {
    assert.equal(validateOrigin(post({ origin: "http://192.168.68.77:3100", host: "localhost:3100" })), false);
    assert.equal(validateOrigin(post({ origin: "http://localhost:3000", host: "localhost:3100" })), false);
  });
  test("a DOMAIN name is never trusted from the Host header, even when Origin and Host agree (DNS rebinding)", () => {
    assert.equal(validateOrigin(post({ origin: "http://evil.example:3100", host: "evil.example:3100" })), false);
  });
  test("with no Origin, only Sec-Fetch-Site: same-origin passes; nothing at all is refused", () => {
    assert.equal(validateOrigin(post({ secFetchSite: "same-origin" })), true);
    assert.equal(validateOrigin(post({ secFetchSite: "cross-site" })), false);
    assert.equal(validateOrigin(post({})), false);
  });
});

describe("production and tests", () => {
  test("production never trusts the Host header: a LAN-address Origin is refused unless APP_ORIGIN says so", () => {
    process.env.NODE_ENV = "production";
    assert.equal(validateOrigin(post({ origin: "http://192.168.68.77:3100", host: "192.168.68.77:3100" })), false);
    assert.equal(validateOrigin(post({ origin: "http://localhost:3100", host: "localhost:3100" })), true, "the request's own URL origin still matches");
  });
  test("an explicit APP_ORIGIN is the only accepted origin, in every mode", () => {
    for (const mode of ["development", "production", "test"]) {
      process.env.NODE_ENV = mode;
      process.env.APP_ORIGIN = "https://shop.example";
      assert.equal(validateOrigin(post({ origin: "https://shop.example", host: "localhost:3100" })), true, mode);
      assert.equal(validateOrigin(post({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" })), false, mode);
    }
  });
  test("under NODE_ENV=test the Host header is not consulted", () => {
    process.env.NODE_ENV = "test";
    assert.equal(validateOrigin(post({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" })), false);
  });
});
