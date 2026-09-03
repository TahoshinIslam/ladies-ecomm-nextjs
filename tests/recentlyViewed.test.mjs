// Unit tests for hooks/useRecentlyViewed.js — no new test dependency, uses
// Node's built-in runner (`node --test`). Exercises the real exported
// functions against an in-memory localStorage stand-in, not a
// reimplementation of the logic.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

globalThis.window = { localStorage: createMockLocalStorage() };

const { recordProductView, getHistorySnapshot, historyToIds } = await import(
  "../hooks/useRecentlyViewed.js"
);

const STORAGE_KEY = "tahos_recently_viewed";

function resetStorage(raw) {
  if (raw === undefined) globalThis.window.localStorage.removeItem(STORAGE_KEY);
  else globalThis.window.localStorage.setItem(STORAGE_KEY, raw);
}

describe("recordProductView", () => {
  beforeEach(() => resetStorage());

  test("deduplicates: viewing the same product twice keeps one entry", () => {
    recordProductView("p1");
    recordProductView("p2");
    recordProductView("p1");
    const history = getHistorySnapshot();
    assert.equal(history.filter((e) => e.id === "p1").length, 1);
    assert.equal(history.length, 2);
  });

  test("moves a re-viewed product back to the front", () => {
    recordProductView("p1");
    recordProductView("p2");
    recordProductView("p3");
    recordProductView("p1");
    const history = getHistorySnapshot();
    assert.equal(history[0].id, "p1");
    assert.deepEqual(
      history.map((e) => e.id),
      ["p1", "p3", "p2"],
    );
  });

  test("caps history at 12 entries, evicting the oldest first", () => {
    for (let i = 0; i < 14; i++) recordProductView(`p${i}`);
    const history = getHistorySnapshot();
    assert.equal(history.length, 12);
    assert.equal(history[0].id, "p13");
    assert.equal(history.at(-1).id, "p2"); // p0 and p1 evicted
  });

  test("ignores a missing or non-string id instead of throwing", () => {
    recordProductView(undefined);
    recordProductView(null);
    recordProductView(42);
    assert.equal(getHistorySnapshot().length, 0);
  });

  test("never mixes with the wishlist key", () => {
    recordProductView("p1");
    assert.equal(globalThis.window.localStorage.getItem("tahos_saved"), null);
    assert.notEqual(globalThis.window.localStorage.getItem(STORAGE_KEY), null);
  });
});

describe("getHistorySnapshot corrupted-storage recovery", () => {
  test("invalid JSON recovers to an empty list instead of throwing", () => {
    resetStorage("{not valid json");
    assert.deepEqual(getHistorySnapshot(), []);
  });

  test("a non-array root recovers to an empty list", () => {
    resetStorage(JSON.stringify({ id: "p1" }));
    assert.deepEqual(getHistorySnapshot(), []);
  });

  test("malformed entries are dropped, well-formed ones survive", () => {
    resetStorage(
      JSON.stringify([
        { id: "p1", viewedAt: 100 }, // valid
        { id: "", viewedAt: 100 }, // empty id
        { id: "p2" }, // missing viewedAt
        "p3", // not an object
        null,
        { id: "p4", viewedAt: 200 }, // valid
      ]),
    );
    const history = getHistorySnapshot();
    assert.deepEqual(
      history.map((e) => e.id),
      ["p1", "p4"],
    );
  });
});

describe("historyToIds (current-product exclusion)", () => {
  test("excludes the given id and preserves order otherwise", () => {
    const history = [
      { id: "p3", viewedAt: 3 },
      { id: "p2", viewedAt: 2 },
      { id: "p1", viewedAt: 1 },
    ];
    assert.deepEqual(historyToIds(history, "p2"), ["p3", "p1"]);
  });

  test("no exclusion when excludeId is absent from history", () => {
    const history = [{ id: "p1", viewedAt: 1 }];
    assert.deepEqual(historyToIds(history, "does-not-exist"), ["p1"]);
  });

  test("empty history yields an empty id list", () => {
    assert.deepEqual(historyToIds([], "p1"), []);
  });
});
