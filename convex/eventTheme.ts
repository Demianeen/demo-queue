import { ConvexError, v } from "convex/values";
import type { EventTheme } from "../lib/event-theme";

export const eventThemeValidator = v.object({
  background: v.string(), foreground: v.string(), accent: v.string(),
  font: v.union(v.literal("sans"), v.literal("serif"), v.literal("mono")), radius: v.number(),
});

export function validateEventTheme(theme: EventTheme) {
  if (![theme.background, theme.foreground, theme.accent].every((color) => /^#[0-9a-f]{6}$/i.test(color))) {
    throw new ConvexError("Use six-digit hex colors, such as #ffffff.");
  }
  if (!Number.isInteger(theme.radius) || theme.radius < 0 || theme.radius > 24) {
    throw new ConvexError("Corner radius must be between 0 and 24 pixels.");
  }
}
