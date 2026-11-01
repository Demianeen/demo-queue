import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EVENT_TRACKS,
  normalizeTrackInput,
  normalizeTrackList,
  submissionTrackNames,
  trackKey,
} from "../lib/tracks.ts";

test("track names are trimmed, collapsed and compared without case", () => {
  assert.deepEqual(normalizeTrackInput({ name: "  AI   agents ", description: "  " }), {
    name: "AI agents",
    description: undefined,
  });
  assert.equal(trackKey("AI Agents"), trackKey(" ai  agents"));
  assert.throws(() => normalizeTrackInput({ name: "   " }), /Enter a track name/);
  assert.throws(() => normalizeTrackInput({ name: "x".repeat(41) }), /40 characters/);
  assert.throws(() => normalizeTrackInput({ name: "ok", description: "x".repeat(141) }), /140 characters/);
});

test("a track list drops blank rows, rejects duplicates and caps the count", () => {
  assert.deepEqual(
    normalizeTrackList([{ name: "AI" }, { name: "" }, { name: "Tools", description: "Dev tools" }]),
    [{ name: "AI", description: undefined }, { name: "Tools", description: "Dev tools" }],
  );
  assert.throws(() => normalizeTrackList([{ name: "AI" }, { name: "ai " }]), /"ai" is listed twice/);
  const tooMany = Array.from({ length: MAX_EVENT_TRACKS + 1 }, (_, index) => ({ name: `Track ${index}` }));
  assert.throws(() => normalizeTrackList(tooMany), /no more than 20/);
});

test("submissions show their tracks, or the legacy category until migrated", () => {
  const byId = new Map([
    ["a", { name: "AI" }],
    ["b", { name: "Tools" }],
  ]);
  assert.deepEqual(submissionTrackNames({ trackIds: ["b", "a", "gone"] }, byId), ["Tools", "AI"]);
  assert.deepEqual(submissionTrackNames({ category: " Hardware " }, byId), ["Hardware"]);
  assert.deepEqual(submissionTrackNames({ trackIds: [], category: "Hardware" }, byId), []);
  assert.deepEqual(submissionTrackNames({}, byId), []);
});
