import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    GOOGLE_DRIVE_FOLDER_ID: v.optional(v.string()),
    GOOGLE_PRIVATE_KEY: v.optional(v.string()),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_MODEL: v.optional(v.string()),
  },
});
