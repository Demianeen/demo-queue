export const DEVDAY_THEME_NAME = "DevDay Exchange Community Hackathon";

export const VISUAL_STYLES = ["neutral", "codex", "outpost", "astra", "devday"] as const;

export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  neutral: "Base",
  codex: "Codex",
  outpost: "Outpost",
  astra: "GPT-6 Astra",
  devday: DEVDAY_THEME_NAME,
};

export function normalizeVisualStyle(value: string | undefined): VisualStyle {
  return VISUAL_STYLES.includes(value as VisualStyle) ? (value as VisualStyle) : "codex";
}

export function isOutpostStyle(value: VisualStyle): value is "outpost" {
  return value === "outpost";
}

export const MAX_CUSTOM_STYLES = 100;
export const MAX_ORGANIZATION_STYLES = MAX_CUSTOM_STYLES + VISUAL_STYLES.length;
export const MAX_STYLE_BRANDS = 50;
