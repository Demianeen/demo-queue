import assert from "node:assert/strict";
import test from "node:test";

import { parsePreviewPage, parsePreviewStyle, previewStyleSegment, stylePreviewPath } from "../lib/style-preview.ts";

const theme = { background: "#0D0F10", foreground: "#f3eee3", accent: "#4f46e5", font: "serif", radius: 12 };

test("a built-in style is addressed by its name only", () => {
  for (const preset of ["neutral", "codex", "outpost", "astra", "devday"]) {
    assert.equal(previewStyleSegment({ visualStyle: preset }), preset);
    assert.deepEqual(parsePreviewStyle(preset), { visualStyle: preset });
  }
  assert.equal(stylePreviewPath({ visualStyle: "outpost" }, "welcome"), "/preview/outpost/welcome");
});

test("a saved style carries only its five theme values, and they read back the same", () => {
  const segment = previewStyleSegment({ visualStyle: "neutral", theme });
  assert.equal(segment, "theme-0d0f10-f3eee3-4f46e5-serif-12");
  assert.deepEqual(parsePreviewStyle(segment), { visualStyle: "neutral", theme: { ...theme, background: "#0d0f10" } });
  assert.equal(stylePreviewPath({ visualStyle: "neutral", theme }, "submit"), "/preview/theme-0d0f10-f3eee3-4f46e5-serif-12/submit");
});

test("the radius is clamped to what a style can save", () => {
  assert.equal(parsePreviewStyle("theme-ffffff-000000-000000-sans-999").theme.radius, 24);
  assert.equal(previewStyleSegment({ visualStyle: "neutral", theme: { ...theme, radius: 40 } }), "theme-0d0f10-f3eee3-4f46e5-serif-24");
  assert.equal(previewStyleSegment({ visualStyle: "neutral", theme: { ...theme, radius: -3 } }), "theme-0d0f10-f3eee3-4f46e5-serif-0");
});

test("anything else in the address is refused", () => {
  for (const segment of ["", "outpost-orange", "theme-ffffff-000000-000000-comic-6", "theme-fff-000000-000000-sans-6", "theme-ffffff-000000-000000-sans-6-extra", "theme-url(x)-000000-000000-sans-6", "theme-ffffff-000000-000000-sans--1", "theme-gggggg-000000-000000-sans-6"]) {
    assert.equal(parsePreviewStyle(segment), null, segment);
  }
  assert.equal(parsePreviewPage("stage"), "stage");
  assert.equal(parsePreviewPage("submit"), "submit");
  assert.equal(parsePreviewPage("admin"), null);
});
