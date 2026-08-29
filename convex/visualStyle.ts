import { v } from "convex/values";
import { VISUAL_STYLES } from "../lib/visual-style";

export const visualStyleValidator = v.union(
  ...VISUAL_STYLES.map((style) => v.literal(style)),
);
