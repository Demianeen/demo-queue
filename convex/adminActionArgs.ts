import { v } from "convex/values";

export const aiShuffleArgs = v.object({
  slug: v.string(),
  prompt: v.string(),
});

export const createJudgingSheetArgs = v.object({
  slug: v.string(),
});
