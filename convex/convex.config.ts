import { defineApp } from "convex/server";
import { v } from "convex/values";
import tableHistory from "@convex-dev/table-history/convex.config";

const app = defineApp({
  env: {
    GOOGLE_DRIVE_FOLDER_ID: v.optional(v.string()),
    GOOGLE_OAUTH_CLIENT_ID: v.optional(v.string()),
    GOOGLE_OAUTH_CLIENT_SECRET: v.optional(v.string()),
    GOOGLE_OAUTH_REFRESH_TOKEN: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_MODEL: v.optional(v.string()),
  },
});

app.use(tableHistory, { name: "judgingDecisionHistory" });
export default app;
