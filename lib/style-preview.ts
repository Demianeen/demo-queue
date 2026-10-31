// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { VISUAL_STYLES, type VisualStyle } from "./visual-style.ts";
import type { EventTheme } from "./event-theme.ts";

/**
 * The public style preview: /preview/<style>/<page>. It renders the real
 * participant pages and stage with sample data, so a phone can open it with
 * no sign-in. The address holds only the style: a built-in preset by name, or
 * a saved style's five theme values, "theme-<background>-<foreground>-<accent>-<font>-<radius>".
 */
export const PREVIEW_PAGES = ["stage", "welcome", "submit"] as const;
export type PreviewPage = (typeof PREVIEW_PAGES)[number];

export const PREVIEW_PAGE_LABELS: Record<PreviewPage, string> = {
  stage: "Stage",
  welcome: "Welcome",
  submit: "Submit form",
};

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
