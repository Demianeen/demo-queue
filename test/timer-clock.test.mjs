import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatSignedClock, submissionsClockLabel, timeLeftMs, timerEndsAt } from "../lib/timer-clock.ts";

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

test("the submissions clock says the deadline passed once it is below zero", () => {
  assert.equal(submissionsClockLabel(5 * minute, "Submissions close in"), "Submissions close in");
  assert.equal(submissionsClockLabel(0, "Submissions close in"), "Submissions close in");
  assert.equal(submissionsClockLabel(-1_000, "Submissions close in"), "Deadline passed");
  assert.equal(submissionsClockLabel(-2 * minute, "On clock"), "Deadline passed");
  // Below zero both read the same: a minus, then minutes and seconds.
  assert.equal(formatSignedClock(65_000), "1:05");
  assert.equal(formatSignedClock(500), "0:01");
  assert.equal(formatSignedClock(0), "0:00");
  assert.equal(formatSignedClock(-500), "-0:01");
  assert.equal(formatSignedClock(-65_000), "-1:05");
  assert.equal(formatSignedClock(-125 * 60_000), "-125:00");
  const tabs = readFileSync(new URL("../components/live/PhaseTabs.tsx", import.meta.url), "utf8");
  assert.match(tabs, /label="Submissions close in"[^\n]*countsBelowZero/, "the Submissions tab clock counts below zero");
  assert.match(readFileSync(new URL("../components/StagePresentation.tsx", import.meta.url), "utf8"), /formatSignedClock/, "the projector uses the same reading");
  // The projector and the organiser's Submissions tab both label it this way.
  for (const file of ["components/StagePresentation.tsx", "components/live/PhaseTabs.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /submissionsClockLabel\(/, `${file} should label the submissions clock`);
  }
});
