import type { CSSProperties } from "react";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { DEFAULT_EVENT_THEME, contrastText, type EventTheme } from "./event-theme.ts";
import type { VisualStyle } from "./visual-style.ts";

/**
 * The event theme contract. A theme is three layers:
 * 1. tokens, which every participant page and the stage read;
 * 2. a shell: the page layout (card or split) and the stage layout (classic or sidebar);
 * 3. named slots that a theme fills with an image, video, scene or text. Empty slots collapse.
 * Nothing here reaches the organiser app, which reads only the `--dq-*` tokens.
 */
export type EventPageShell = "card" | "split";
export type EventStageLayout = "classic" | "sidebar";
export type EventPanel = "flat" | "glass";
export type EventSlot = "background" | "lockup" | "hero" | "art" | "qrMascot" | "copy";

export type EventTokens = {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  border: string;
  fontBody: string;
  fontDisplay: string;
  radius: number;
  panel: EventPanel;
};

export type EventThemeContract = {
  tokens: EventTokens;
  shell: EventPageShell;
  stage: EventStageLayout;
  stageTitle: "team" | "project";
  /** Which slots the style fills. The style's own components and CSS render them. */
  slots: EventSlot[];
};

const GEIST = "var(--font-geist-sans), sans-serif";

const FIXED: Record<Exclude<VisualStyle, "neutral">, EventThemeContract> = {
  codex: {
    tokens: { bg: "#4f46e5", surface: "rgba(255, 255, 255, 0.72)", fg: "#0b0c10", muted: "#5b6170", accent: "#4f46e5", border: "#e6e3f5", fontBody: GEIST, fontDisplay: GEIST, radius: 18, panel: "glass" },
    shell: "card", stage: "classic", stageTitle: "team", slots: ["background", "lockup", "qrMascot"],
  },
  outpost: {
    tokens: { bg: "#080a0b", surface: "#f3eee3", fg: "#080a0b", muted: "#5b5b55", accent: "#080a0b", border: "#d9d2c3", fontBody: "var(--font-outpost-body), Inter, sans-serif", fontDisplay: "var(--font-outpost-display), sans-serif", radius: 0, panel: "flat" },
    shell: "split", stage: "classic", stageTitle: "project", slots: ["background", "lockup", "hero", "qrMascot"],
  },
  astra: {
    tokens: { bg: "#030405", surface: "#f5f5f3", fg: "#030405", muted: "#5e5e5a", accent: "#030405", border: "#dededa", fontBody: "var(--font-astra-sans, var(--font-geist-sans)), sans-serif", fontDisplay: "var(--font-astra-sans, var(--font-geist-sans)), sans-serif", radius: 12, panel: "glass" },
    shell: "split", stage: "classic", stageTitle: "team", slots: ["background", "lockup", "hero", "art", "qrMascot"],
  },
  devday: {
    tokens: { bg: "#ffffff", surface: "#ffffff", fg: "#000000", muted: "#4b4b4b", accent: "#00a67e", border: "#000000", fontBody: "var(--font-devday-sans, var(--font-geist-sans)), sans-serif", fontDisplay: "var(--font-devday-sans, var(--font-geist-sans)), sans-serif", radius: 0, panel: "flat" },
    shell: "split", stage: "sidebar", stageTitle: "team", slots: ["lockup", "hero", "art", "qrMascot"],
  },
};

/** Base (neutral) is the one style an organiser recolours, from its five saved values. */
export function baseContract(theme: EventTheme = DEFAULT_EVENT_THEME): EventThemeContract {
  const font = theme.font === "serif" ? "Georgia, serif" : theme.font === "mono" ? "ui-monospace, monospace" : GEIST;
  return {
    tokens: {
      bg: theme.background, surface: theme.background, fg: theme.foreground,
      muted: `color-mix(in srgb, ${theme.foreground} 68%, transparent)`, accent: theme.accent,
      border: `color-mix(in srgb, ${theme.foreground} 20%, transparent)`, fontBody: font, fontDisplay: font,
      radius: theme.radius, panel: "flat",
    },
    shell: "card", stage: "classic", stageTitle: "team", slots: ["copy"],
  };
}

export function eventThemeContract(style: VisualStyle, theme?: EventTheme): EventThemeContract {
  return style === "neutral" ? baseContract(theme) : FIXED[style];
}

/** The CSS variables for a contract. `--event-font` stays for the rules written before the contract. */
export function eventTokenProperties({ tokens }: EventThemeContract): CSSProperties {
  return {
    "--event-bg": tokens.bg,
    "--event-surface": tokens.surface,
    "--event-fg": tokens.fg,
    "--event-muted": tokens.muted,
    "--event-accent": tokens.accent,
    "--event-accent-fg": tokens.accent.startsWith("#") && tokens.accent.length === 7 ? contrastText(tokens.accent) : "#ffffff",
    "--event-border": tokens.border,
    "--event-font": tokens.fontBody,
    "--event-font-body": tokens.fontBody,
    "--event-font-display": tokens.fontDisplay,
    "--event-radius": `${tokens.radius}px`,
    "--event-panel": tokens.panel,
    "--event-danger": "#c2341e",
    "--event-warning": "#b45309",
  } as CSSProperties;
}

/**
 * Attributes for the root of a participant page or the stage: the tokens, and
 * the shell and stage layout by name. Base reads the tokens; the four fixed
 * styles still draw from their own CSS, which reads none of them yet.
 */
export function eventRootProps(style: VisualStyle, theme?: EventTheme, surface: "page" | "stage" = "page") {
  const contract = eventThemeContract(style, theme);
  return {
    "data-event-shell": contract.shell,
    "data-event-stage": surface === "stage" ? contract.stage : undefined,
    "data-event-slots": contract.slots.join(" "),
    style: eventTokenProperties(contract),
  };
}
