import assert from "node:assert/strict";
import { test } from "node:test";
import { aiReadChips, ROW_AI_CHIP_LIMIT, splitRowChips } from "../lib/ai-read.ts";

const read = {
  status: "ready",
  overall: "A strong AI agents entry built on Daytona.",
  tracks: [
    { id: "t1", name: "AI agents", level: "strong", reason: "Books meetings through tool calls.", described: true },
    { id: "t2", name: "Go-to-market", level: null, reason: null, described: false },
    { id: "t3", name: "Developer tools", level: "weak", reason: "Built for office teams.", described: true },
  ],
  sponsors: [
    { id: "s1", name: "Daytona", level: "used", reason: "Runs plans in a sandbox." },
    { id: "s2", name: "OpenAI", level: "light", reason: null },
    { id: "s3", name: "Vercel", level: null, reason: null },
  ],
};

test("a row gets a chip per track and sponsor with a level, tracks first, with the reason to hover", () => {
  const chips = aiReadChips(read);
  assert.deepEqual(chips.map((chip) => `${chip.name} · ${chip.level} (${chip.tone})`), [
    "AI agents · Strong (good)",
    "Developer tools · Weak (none)",
    "Daytona · Used (good)",
    "OpenAI · Light (some)",
  ]);
  assert.equal(chips[0].tip, "AI agents · Strong fit: Books meetings through tool calls.");
  assert.equal(chips[3].tip, "OpenAI · Light");
  assert.deepEqual(aiReadChips({ ...read, status: "checking" }), [], "no levels while a new read is on its way");
  assert.deepEqual(aiReadChips(null), []);
});

test("past three AI chips a row shows the first two and +N for the rest", () => {
  assert.equal(ROW_AI_CHIP_LIMIT, 3);
  assert.deepEqual(splitRowChips([1, 2]), { shown: [1, 2], rest: [] });
  assert.deepEqual(splitRowChips([1, 2, 3]), { shown: [1, 2, 3], rest: [] }, "exactly three fit");
  assert.deepEqual(splitRowChips([1, 2, 3, 4]), { shown: [1, 2], rest: [3, 4] }, "four: two and +2");
  assert.deepEqual(splitRowChips([1, 2, 3, 4, 5, 6]), { shown: [1, 2], rest: [3, 4, 5, 6] });
  assert.deepEqual(splitRowChips([]), { shown: [], rest: [] });
});
