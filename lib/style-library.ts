// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { VISUAL_STYLES, VISUAL_STYLE_LABELS, type VisualStyle } from "./visual-style.ts";
import type { EventTheme } from "./event-theme.ts";

/** An organizationStyles row, as the Styles page and New event read it. */
export type StyleRow = {
  _id: string; _creationTime: number; name: string; theme: EventTheme;
  preset?: VisualStyle; isDefault: boolean; brandId?: string;
};
export type BrandRow = { _id: string; _creationTime: number; name: string };

/**
 * One style an organizer can pick: a built-in preset or a saved style.
 * `key` is the preset name or the saved style's id.
 */
export type StyleEntry = {
  key: string; name: string; isDefault: boolean; brandId?: string;
  preset?: VisualStyle; savedId?: string; theme?: EventTheme; createdAt?: number;
};
export type StyleGroup<Brand extends BrandRow = BrandRow> = { brand: Brand | null; styles: StyleEntry[] };

/** Every style: the five built-ins (with the default and brand their row may carry) and the saved ones. */
export function styleEntries(rows: StyleRow[]): StyleEntry[] {
  const presets = VISUAL_STYLES.map((preset: VisualStyle) => {
    const row = rows.find((style) => style.preset === preset);
    return { key: preset, name: VISUAL_STYLE_LABELS[preset], preset, isDefault: row?.isDefault ?? false, brandId: row?.brandId };
  });
  const saved = rows.filter((style) => !style.preset).map((style) => ({
    key: style._id, name: style.name, savedId: style._id, theme: style.theme,
    createdAt: style._creationTime, isDefault: style.isDefault, brandId: style.brandId,
  }));
  return [...presets, ...saved];
}

/** The default first, then saved styles newest first, then the built-ins in their fixed order. */
function compareStyles(a: StyleEntry, b: StyleEntry) {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  const aBuiltIn = a.preset !== undefined, bBuiltIn = b.preset !== undefined;
  if (aBuiltIn !== bBuiltIn) return aBuiltIn ? 1 : -1;
  if (aBuiltIn && bBuiltIn) return VISUAL_STYLES.indexOf(a.preset!) - VISUAL_STYLES.indexOf(b.preset!);
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

/**
 * Styles grouped by brand: brands in the order they were made (empty ones
 * too, so a new brand shows), then the styles with no brand. A style whose
 * brand is gone counts as having none.
 */
export function groupStyles<Brand extends BrandRow>(entries: StyleEntry[], brands: Brand[]): StyleGroup<Brand>[] {
  const ordered = [...brands].sort((a, b) => a._creationTime - b._creationTime);
  const known = new Set(ordered.map((brand) => brand._id));
  const groups: StyleGroup<Brand>[] = ordered.map((brand) => ({ brand, styles: entries.filter((entry) => entry.brandId === brand._id).sort(compareStyles) }));
  const unbranded = entries.filter((entry) => !entry.brandId || !known.has(entry.brandId)).sort(compareStyles);
  if (unbranded.length) groups.push({ brand: null, styles: unbranded });
  return groups;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "31 Oct", with the year only when it is not this year: "4 Mar 2025". */
export function styleDate(time: number, now = Date.now()) {
  return new Date(time).getUTCFullYear() === new Date(now).getUTCFullYear() ? SHORT_DATE.format(time) : LONG_DATE.format(time);
}
