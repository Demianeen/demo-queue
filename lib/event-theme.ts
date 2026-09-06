import type { CSSProperties } from "react";

export type EventTheme = {
  background: string;
  foreground: string;
  accent: string;
  font: "sans" | "serif" | "mono";
  radius: number;
};

export const DEFAULT_EVENT_THEME: EventTheme = {
  background: "#ffffff", foreground: "#101113", accent: "#101113", font: "sans", radius: 6,
};

export function contrastText(color: string) {
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? "#101113" : "#ffffff";
}

export function eventThemeProperties(theme: EventTheme = DEFAULT_EVENT_THEME): CSSProperties {
  return {
    "--event-bg": theme.background,
    "--event-fg": theme.foreground,
    "--event-accent": theme.accent,
    "--event-accent-fg": contrastText(theme.accent),
    "--event-radius": `${theme.radius}px`,
    "--event-font": theme.font === "serif" ? "Georgia, serif" : theme.font === "mono" ? "ui-monospace, monospace" : "var(--font-geist-sans), sans-serif",
  } as CSSProperties;
}
