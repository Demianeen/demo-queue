export const VISUAL_STYLES = ["codex", "outpost", "astra"] as const;

export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  codex: "Codex",
  outpost: "Outpost",
  astra: "GPT-6 Astra",
};

export function normalizeVisualStyle(value: string | undefined): VisualStyle {
  return VISUAL_STYLES.includes(value as VisualStyle) ? (value as VisualStyle) : "codex";
}

export function isOutpostStyle(value: VisualStyle): value is "outpost" {
  return value === "outpost";
}
