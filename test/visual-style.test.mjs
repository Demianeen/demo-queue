import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_STYLES,
  isOutpostStyle,
  normalizeVisualStyle,
} from "../lib/visual-style.ts";

test("legacy or unknown styles fall back to Codex", () => {
  assert.equal(normalizeVisualStyle(undefined), "codex");
  assert.equal(normalizeVisualStyle(""), "codex");
  assert.equal(normalizeVisualStyle("outpost-orange"), "codex");
});

test("known visual styles normalize unchanged", () => {
  for (const style of VISUAL_STYLES) {
    assert.equal(normalizeVisualStyle(style), style);
  }
});

test("only the explicit Outpost style selects Outpost rendering", () => {
  for (const style of VISUAL_STYLES) {
    assert.equal(isOutpostStyle(style), style === "outpost");
  }
});
