// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { VISUAL_STYLES, type VisualStyle } from "./visual-style.ts";
import type { EventTheme } from "./event-theme.ts";

/**
 * The public style preview: /preview/<style>/<page>. It renders the real
 * participant pages and stage with sample data, so a phone can open it with
 * no sign-in. The address holds only the style: a built-in preset by name, or
 * a saved style's five theme values, "theme-<background>-<foreground>-<accent>-<font>-<radius>".
 */
export const PREVIEW_PAGES = [
  "stage", "welcome", "submit",
  "status-submitted", "status-finalist", "status-1st", "status-2nd", "status-3rd",
  "winners", "winners-only",
] as const;
export type PreviewPage = (typeof PREVIEW_PAGES)[number];

/**
 * The preview's tabs, one per page a person opens. A tab with more than one
 * page shows them as states: the stage through the night (welcome while
 * submissions are open, the pitches, the winners with or without the
 * finalists), and the status page as each team sees it.
 */
export const PREVIEW_TABS: { label: string; stateLabel?: string; pages: { page: PreviewPage; label: string }[] }[] = [
  { label: "Stage", stateLabel: "Moment", pages: [
    { page: "welcome", label: "Welcome" }, { page: "stage", label: "Pitching" },
    { page: "winners", label: "Winners" }, { page: "winners-only", label: "Winners only" },
  ] },
  { label: "Submit form", pages: [{ page: "submit", label: "Submit form" }] },
  { label: "Status page", stateLabel: "Status", pages: [
    { page: "status-submitted", label: "Submitted" }, { page: "status-finalist", label: "Finalist" },
    { page: "status-1st", label: "1st" }, { page: "status-2nd", label: "2nd" }, { page: "status-3rd", label: "3rd" },
  ] },
];

export function previewTab(page: PreviewPage) {
  return PREVIEW_TABS.find((tab) => tab.pages.some((item) => item.page === page)) ?? PREVIEW_TABS[0];
}

/** "Status page, 1st" or "Stage": what a page is, for titles and labels. */
export function previewPageLabel(page: PreviewPage) {
  const tab = previewTab(page);
  const state = tab.pages.length > 1 ? tab.pages.find((item) => item.page === page)?.label : undefined;
  return state ? `${tab.label}, ${state}` : tab.label;
}

export type PreviewStyle = { visualStyle: VisualStyle; theme?: EventTheme };

const FONTS = ["sans", "serif", "mono"] as const;
const THEME_SEGMENT = /^theme-([0-9a-f]{6})-([0-9a-f]{6})-([0-9a-f]{6})-([a-z]+)-(\d{1,3})$/;

export function previewStyleSegment(style: PreviewStyle) {
  if (style.visualStyle !== "neutral" || !style.theme) return style.visualStyle;
  const { background, foreground, accent, font, radius } = style.theme;
  const hex = (color: string) => color.replace(/^#/, "").toLowerCase();
  return `theme-${hex(background)}-${hex(foreground)}-${hex(accent)}-${font}-${Math.min(Math.max(Math.round(radius), 0), 24)}`;
}

/** The style a segment names, or null when it names none: the route then answers 404. */
export function parsePreviewStyle(segment: string): PreviewStyle | null {
  const value = segment.toLowerCase();
  if ((VISUAL_STYLES as readonly string[]).includes(value)) return { visualStyle: value as VisualStyle };
  const match = THEME_SEGMENT.exec(value);
  if (!match) return null;
  const [, background, foreground, accent, font, radius] = match;
  if (!(FONTS as readonly string[]).includes(font)) return null;
  return {
    visualStyle: "neutral",
    theme: { background: `#${background}`, foreground: `#${foreground}`, accent: `#${accent}`, font: font as EventTheme["font"], radius: Math.min(Number(radius), 24) },
  };
}

export function parsePreviewPage(value: string): PreviewPage | null {
  return (PREVIEW_PAGES as readonly string[]).includes(value) ? value as PreviewPage : null;
}

export function stylePreviewPath(style: PreviewStyle, page: PreviewPage) {
  return `/preview/${previewStyleSegment(style)}/${page}`;
}
