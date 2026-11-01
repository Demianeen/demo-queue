import posthog from "posthog-js";
import { posthogOptions } from "./lib/posthog-browser";

// Without a project token (local runs, fixture-only review) PostHog is not loaded.
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
if (token) posthog.init(token, posthogOptions());
