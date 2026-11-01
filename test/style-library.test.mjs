import assert from "node:assert/strict";
import test from "node:test";

import { groupStyles, styleDate, styleEntries } from "../lib/style-library.ts";

const theme = { background: "#ffffff", foreground: "#101113", accent: "#101113", font: "sans", radius: 6 };
const saved = (id, created, extra = {}) => ({ _id: id, _creationTime: created, name: id, theme, isDefault: false, ...extra });
const presetRow = (preset, extra = {}) => ({ _id: `row-${preset}`, _creationTime: 1, name: preset, theme, preset, isDefault: false, ...extra });

test("every built-in is listed once, carrying the default and brand its row holds", () => {
  const entries = styleEntries([presetRow("outpost", { isDefault: true, brandId: "b1" }), saved("night", 5)]);
  assert.deepEqual(entries.map((entry) => entry.key), ["neutral", "codex", "outpost", "astra", "devday", "night"]);
  assert.deepEqual(entries.find((entry) => entry.key === "outpost"), { key: "outpost", name: "Outpost", preset: "outpost", isDefault: true, brandId: "b1" });
  assert.equal(entries.find((entry) => entry.key === "night").createdAt, 5);
  assert.equal(entries.find((entry) => entry.key === "codex").createdAt, undefined);
});

test("within a group: the default first, then saved styles newest first, then built-ins in their order", () => {
  const entries = styleEntries([saved("old", 10), saved("new", 30), saved("middle", 20), presetRow("astra", { isDefault: true })]);
  const [group] = groupStyles(entries, []);
  assert.equal(group.brand, null);
  assert.deepEqual(group.styles.map((entry) => entry.key), ["astra", "new", "middle", "old", "neutral", "codex", "outpost", "devday"]);
});

test("a saved default goes before newer saved styles", () => {
  const [group] = groupStyles(styleEntries([saved("old", 10, { isDefault: true }), saved("new", 30)]), []);
  assert.deepEqual(group.styles.slice(0, 2).map((entry) => entry.key), ["old", "new"]);
});

test("brands come in creation order, empty brands still show, and No brand is last", () => {
  const brands = [{ _id: "b2", _creationTime: 20, name: "Sponsor" }, { _id: "b1", _creationTime: 10, name: "Ours" }, { _id: "b3", _creationTime: 30, name: "Empty" }];
  const entries = styleEntries([presetRow("codex", { brandId: "b2" }), saved("night", 5, { brandId: "b1" }), presetRow("outpost", { brandId: "b1" }), saved("gone", 6, { brandId: "deleted" })]);
  const groups = groupStyles(entries, brands);
  assert.deepEqual(groups.map((group) => group.brand?.name ?? null), ["Ours", "Sponsor", "Empty", null]);
  assert.deepEqual(groups[0].styles.map((entry) => entry.key), ["night", "outpost"]);
  assert.deepEqual(groups[1].styles.map((entry) => entry.key), ["codex"]);
  assert.deepEqual(groups[2].styles, []);
  // A style whose brand is not listed counts as having none.
  assert.deepEqual(groups[3].styles.map((entry) => entry.key), ["gone", "neutral", "astra", "devday"]);
});

test("No brand is left out when every style has a brand", () => {
  const entries = styleEntries(["neutral", "codex", "outpost", "astra", "devday"].map((preset) => presetRow(preset, { brandId: "b1" })));
  assert.deepEqual(groupStyles(entries, [{ _id: "b1", _creationTime: 1, name: "All" }]).map((group) => group.brand?.name ?? null), ["All"]);
});

test("dates are short, with the year only when it is not this year", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  assert.equal(styleDate(Date.UTC(2026, 9, 31, 1), now), "31 Oct");
  assert.equal(styleDate(Date.UTC(2025, 2, 4), now), "4 Mar 2025");
});
