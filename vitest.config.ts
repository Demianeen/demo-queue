import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    // Tests never reach paid services with keys from the developer's shell.
    env: { OPENAI_API_KEY: "", RESEND_API_KEY: "" },
  },
});
