import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_EVENT_SPONSORS, normalizeSponsorInput, normalizeSponsorList } from "../lib/sponsors.ts";

test("a sponsor's name and usage are trimmed, and an empty usage is dropped", () => {
  assert.deepEqual(normalizeSponsorInput({ name: "  Daytona  ", usage: " Runs code in   sandboxes " }), { name: "Daytona", usage: "Runs code in sandboxes" });
  assert.deepEqual(normalizeSponsorInput({ name: "OpenAI", usage: "  " }), { name: "OpenAI", usage: undefined });
  assert.throws(() => normalizeSponsorInput({ name: " " }), /Enter a sponsor name/);
  assert.throws(() => normalizeSponsorInput({ name: "x".repeat(41) }), /40 characters/);
  assert.throws(() => normalizeSponsorInput({ name: "Daytona", usage: "x".repeat(141) }), /140 characters/);
});

test("a sponsor list drops blank rows, refuses repeated names and keeps to the limit", () => {
  assert.deepEqual(normalizeSponsorList([{ name: "Daytona" }, { name: "", usage: "" }]), [{ name: "Daytona", usage: undefined }]);
  assert.throws(() => normalizeSponsorList([{ name: "Daytona" }, { name: "daytona" }]), /listed twice/);
  assert.throws(() => normalizeSponsorList(Array.from({ length: MAX_EVENT_SPONSORS + 1 }, (_, index) => ({ name: `Sponsor ${index}` }))), /no more than/);
});
