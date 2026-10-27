import type { NextConfig } from "next";
import { getEnv } from "./app/env";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  // Design review runs the real UI with local fixtures; normal builds still
  // require the configured backend URL and retain the existing validation.
  const previewOnly = phase === PHASE_DEVELOPMENT_SERVER && process.env.DEMO_QUEUE_THEME_PREVIEW === "1";
  if (!previewOnly) getEnv();
  return {};
}
