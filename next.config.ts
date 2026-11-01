import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";
import { getEnv } from "./app/env";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { mcpRewrites } from "./lib/mcp-routing";

function config(phase: string): NextConfig {
  // Design review runs the real UI with local fixtures; normal builds still
  // require the configured backend URL and retain the existing validation.
  const previewOnly = phase === PHASE_DEVELOPMENT_SERVER && process.env.DEMO_QUEUE_THEME_PREVIEW === "1";
  // A Vercel preview has its own Convex deployment, which serves no MCP, so there is nothing to proxy.
  const routes = previewOnly || process.env.VERCEL_ENV === "preview" ? [] : mcpRewrites(getEnv().NEXT_PUBLIC_CONVEX_URL);
  return {
    async rewrites() { return routes; },
    // PostHog's API paths end in a slash, proxied by the middleware; Next.js
    // would otherwise redirect them.
    skipTrailingSlashRedirect: true,
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

// Builds that have a PostHog key and project upload their source maps, so
// error stacks are readable, then delete them so they are never served.
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;

export default personalApiKey && projectId
  ? withPostHogConfig(config, {
    personalApiKey,
    projectId,
    host: "https://eu.posthog.com",
    sourcemaps: { enabled: true, releaseName: "demo-queue", releaseVersion: process.env.VERCEL_GIT_COMMIT_SHA, deleteAfterUpload: true },
  })
  : config;
