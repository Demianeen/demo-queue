import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    // Tests never reach paid services with keys from the developer's shell.
    env: { OPENAI_API_KEY: "", RESEND_API_KEY: "", LUMA_API_KEY: "", LUMA_ORGANIZATION_IDS: "" },
  },
});
