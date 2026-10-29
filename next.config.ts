import type { NextConfig } from "next";
import { getEnv } from "./app/env";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { mcpRewrites } from "./lib/mcp-routing";

export default function config(phase: string): NextConfig {
  // Design review runs the real UI with local fixtures; normal builds still
  // require the configured backend URL and retain the existing validation.
  const previewOnly = phase === PHASE_DEVELOPMENT_SERVER && process.env.DEMO_QUEUE_THEME_PREVIEW === "1";
  const routes = previewOnly ? [] : mcpRewrites(getEnv().NEXT_PUBLIC_CONVEX_URL);
  return {
    async rewrites() { return routes; },
    async headers() {
      return ["/events/connect", "/events/connections"].map((source) => ({ source, headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ] }));
    },
  };
}
