import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_STYLE_LABELS,
  VISUAL_STYLES,
  isOutpostStyle,
  normalizeVisualStyle,
} from "../lib/visual-style.ts";

test("legacy or unknown styles fall back to Codex", () => {
  assert.equal(normalizeVisualStyle(undefined), "codex");
  assert.equal(normalizeVisualStyle(""), "codex");
  assert.equal(normalizeVisualStyle("outpost-orange"), "codex");
});

test("Astra is available as its own labeled visual style", () => {
  assert.equal(normalizeVisualStyle("astra"), "astra");
  assert.equal(VISUAL_STYLE_LABELS.astra, "GPT-6 Astra");
  assert.equal(isOutpostStyle("astra"), false);
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
