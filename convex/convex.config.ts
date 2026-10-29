import mcp from "@convex-dev/mcp/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import tableHistory from "@convex-dev/table-history/convex.config";

const app = defineApp({
  env: {
    GOOGLE_DRIVE_FOLDER_ID: v.optional(v.string()),
    GOOGLE_OAUTH_CLIENT_ID: v.optional(v.string()),
    GOOGLE_OAUTH_CLIENT_SECRET: v.optional(v.string()),
    GOOGLE_OAUTH_REFRESH_TOKEN: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_MODEL: v.optional(v.string()),
    // Optional GitHub token for README reads in AI summaries: 5,000 requests an hour instead of 60.
    GITHUB_TOKEN: v.optional(v.string()),
    // Read-only Luma API key: links events and prefills socials. Without it, both are off.
    LUMA_API_KEY: v.optional(v.string()),
    // Comma separated WorkOS organisation ids that may use the Luma key (its calendar's owners).
    LUMA_ORGANIZATION_IDS: v.optional(v.string()),
    // Submission emails. Without all three, sending is skipped and logged.
    RESEND_API_KEY: v.optional(v.string()),
    RESEND_FROM_EMAIL: v.optional(v.string()),
    DEMO_QUEUE_SITE_URL: v.optional(v.string()),
  },
});

app.use(mcp);
app.use(tableHistory, { name: "judgingDecisionHistory" });
app.use(resend);
app.use(rateLimiter);
export default app;
