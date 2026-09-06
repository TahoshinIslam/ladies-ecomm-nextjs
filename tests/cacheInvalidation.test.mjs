// Phase 8 — lib/cacheInvalidation.js: proves the invalidation helper never
// turns a cache-layer failure into a misleading application error, never
// invalidates an unrecognized/oversized tag, and de-duplicates tags before
// calling revalidateTag(). Uses node:test's `mock.module` to replace
// "next/cache" — the SAME pattern tests/emailTemplates.test.mjs already
// uses for nodemailer — since calling the real revalidateTag() outside an
// actual Next.js request/build context throws on its own, this is the
// correct way to test this module's own logic in isolation.
//
// Each test mocks "next/cache" fresh and restores it in a `finally` —
// node:test refuses to re-mock an already-mocked specifier, so the
// restore is not optional cleanup here, it's required for the next test
// to run at all.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

let moduleMockUsable = false;
let moduleMockProbeError;
try {
  const probe = await mock.module("node:os", { namedExports: { hostname: () => "probe" } });
  probe.restore();
  moduleMockUsable = true;
} catch (err) {
  moduleMockProbeError = err;
}

const skip = !moduleMockUsable
  ? `node:test module mocking unavailable (${moduleMockProbeError?.message || "unknown error"}) — run with --experimental-test-module-mocks`
  : false;

describe("Phase 8 — invalidateCacheTags() failure handling and tag safety", { skip }, () => {
  test("a throwing revalidateTag() does not propagate — the caller's mutation response is unaffected", async () => {
    const calls = [];
    const cacheMock = await mock.module("next/cache", {
      namedExports: {
        revalidateTag: (tag, profile) => {
          calls.push({ tag, profile });
          throw new Error("simulated cache-store outage");
        },
        unstable_cache: (cb) => cb,
      },
    });
    const originalConsoleError = console.error;
    let loggedArgs;
    console.error = (...args) => { loggedArgs = args; };
    try {
      const { invalidateCacheTags } = await import(`../lib/cacheInvalidation.js?t=${Date.now()}-a`);
      const { CACHE_TAGS } = await import("../lib/cacheTags.js");
      assert.doesNotThrow(() => invalidateCacheTags([CACHE_TAGS.CATALOG]));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].tag, CACHE_TAGS.CATALOG);
      // Generic message only — never the tag value, never a stack, never
      // request context.
      assert.equal(loggedArgs[0], "Cache invalidation failed");
      assert.ok(!String(loggedArgs[1] ?? "").includes(CACHE_TAGS.CATALOG));
    } finally {
      console.error = originalConsoleError;
      cacheMock.restore();
    }
  });

  test("revalidateTag() is always called with the { expire: 0 } immediate-invalidation form, never the deprecated bare-tag form", async () => {
    const calls = [];
    const cacheMock = await mock.module("next/cache", {
      namedExports: {
        revalidateTag: (tag, profile) => { calls.push({ tag, profile }); },
        unstable_cache: (cb) => cb,
      },
    });
    try {
      const { invalidateCacheTags } = await import(`../lib/cacheInvalidation.js?t=${Date.now()}-b`);
      const { CACHE_TAGS, productTag } = await import("../lib/cacheTags.js");
      invalidateCacheTags([CACHE_TAGS.CATALOG, productTag("507f1f77bcf86cd799439011")]);
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.deepEqual(call.profile, { expire: 0 });
      }
    } finally {
      cacheMock.restore();
    }
  });

  test("duplicate tags are de-duplicated into a single revalidateTag() call", async () => {
    const calls = [];
    const cacheMock = await mock.module("next/cache", {
      namedExports: {
        revalidateTag: (tag) => { calls.push(tag); },
        unstable_cache: (cb) => cb,
      },
    });
    try {
      const { invalidateCacheTags } = await import(`../lib/cacheInvalidation.js?t=${Date.now()}-c`);
      const { CACHE_TAGS } = await import("../lib/cacheTags.js");
      invalidateCacheTags([CACHE_TAGS.CATALOG, CACHE_TAGS.CATALOG, CACHE_TAGS.CATALOG]);
      assert.equal(calls.length, 1);
    } finally {
      cacheMock.restore();
    }
  });

  test("an unrecognized tag shape is rejected before any revalidateTag() call is made", async () => {
    const calls = [];
    const cacheMock = await mock.module("next/cache", {
      namedExports: {
        revalidateTag: (tag) => { calls.push(tag); },
        unstable_cache: (cb) => cb,
      },
    });
    try {
      const { invalidateCacheTags } = await import(`../lib/cacheInvalidation.js?t=${Date.now()}-d`);
      assert.throws(() => invalidateCacheTags(["totally-unknown-free-form-tag"]));
      assert.equal(calls.length, 0, "no revalidateTag() call should happen for a rejected tag");
    } finally {
      cacheMock.restore();
    }
  });

  test("an oversized tag is rejected", async () => {
    const cacheMock = await mock.module("next/cache", {
      namedExports: {
        revalidateTag: () => {},
        unstable_cache: (cb) => cb,
      },
    });
    try {
      const { invalidateCacheTags } = await import(`../lib/cacheInvalidation.js?t=${Date.now()}-e`);
      assert.throws(() => invalidateCacheTags(["a".repeat(300)]));
    } finally {
      cacheMock.restore();
    }
  });
});
