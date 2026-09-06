export const VISUAL_STYLES = ["neutral", "codex", "outpost"] as const;

export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  neutral: "Base",
  codex: "Codex",
  outpost: "Outpost",
};

export function normalizeVisualStyle(value: string | undefined): VisualStyle {
  return VISUAL_STYLES.includes(value as VisualStyle) ? (value as VisualStyle) : "codex";
}

export function isOutpostStyle(value: VisualStyle): value is "outpost" {
  return value === "outpost";
}

export const MAX_CUSTOM_STYLES = 100;
export const MAX_ORGANIZATION_STYLES = MAX_CUSTOM_STYLES + VISUAL_STYLES.length;
