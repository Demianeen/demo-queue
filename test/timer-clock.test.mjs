import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { timeLeftMs, timerEndsAt } from "../lib/timer-clock.ts";

const minute = 60_000;

test("a running timer counts down from its end, however old the query is", () => {
  // Convex cached this reading three hours ago: 25 minutes were left then.
  const queriedAt = Date.UTC(2026, 9, 30, 18, 0);
  const reading = { running: true, remainingMs: 25 * minute, serverNow: queriedAt };
  assert.equal(timerEndsAt(reading), queriedAt + 25 * minute);
  assert.equal(timeLeftMs(reading, queriedAt + 5 * minute), 20 * minute);
  // Every surface reads the same number at the same moment, so none can show 0:00 while another shows -200:40.
  assert.equal(timeLeftMs(reading, queriedAt + 3 * 60 * minute), -155 * minute);
});

test("a stored end wins over the query clock", () => {
  const reading = { running: true, remainingMs: 10 * minute, serverNow: 0, endsAt: 30 * minute };
  assert.equal(timeLeftMs(reading, 20 * minute), 10 * minute);
});

test("a paused or idle timer keeps its time, and no timer reads as none left", () => {
  assert.equal(timeLeftMs({ running: false, remainingMs: 7 * minute, serverNow: 0 }, 99 * minute), 7 * minute);
  assert.equal(timeLeftMs(undefined, 0), 0);
  assert.equal(timeLeftMs(null, 0), 0);
});

test("every clock surface reads the time through the shared helper", () => {
  for (const file of [
    "components/live/clock.ts",
    "app/(workspace)/events/[slug]/admin/ClientPage.tsx",
    "app/judge/[slug]/[token]/ClientPage.tsx",
    "components/StagePresentation.tsx",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /timeLeftMs\(/, `${file} should use timeLeftMs`);
    assert.doesNotMatch(source, /Date\.now\(\) - \w*\.?serverNow/, `${file} should not offset by the query clock`);
  }
});
