import assert from "node:assert/strict";
import test from "node:test";

import { forgetSubmission, readRememberedSubmission, rememberSubmission, REMEMBER_FOR_MS } from "../lib/remembered-submission.ts";

function fakeStorage() {
  const values = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  } };
  return values;
}

test("a remembered submission lasts a week, then is dropped", () => {
  const values = fakeStorage();
  const now = Date.UTC(2026, 9, 29);
  rememberSubmission("outpost", "token123", now);
  assert.equal(readRememberedSubmission("outpost", now + REMEMBER_FOR_MS - 1), "token123");
  assert.equal(readRememberedSubmission("outpost", now + REMEMBER_FOR_MS), null);
  assert.equal(values.size, 0);
});

test("Start a new submission forgets it, and unreadable values are dropped", () => {
  const values = fakeStorage();
  rememberSubmission("outpost", "token123");
  forgetSubmission("outpost");
  assert.equal(readRememberedSubmission("outpost"), null);
  values.set("demo-queue:submitted:outpost", "plain-token-without-expiry");
  assert.equal(readRememberedSubmission("outpost"), null);
  assert.equal(values.size, 0);
});

test("blocked storage never throws", () => {
  globalThis.window = { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } };
  assert.doesNotThrow(() => rememberSubmission("outpost", "token123"));
  assert.equal(readRememberedSubmission("outpost"), null);
  assert.doesNotThrow(() => forgetSubmission("outpost"));
});
