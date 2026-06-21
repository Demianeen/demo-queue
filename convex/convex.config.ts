import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_MODEL: v.optional(v.string()),
  },
});
