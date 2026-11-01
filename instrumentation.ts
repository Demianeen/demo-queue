import type { Instrumentation } from "next";

export async function register() {
  // The middleware's Edge runtime has no Node console to copy; without a token PostHog is off.
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (process.env.NEXT_RUNTIME !== "nodejs" || !token) return;
  const { forwardConsoleToPostHog } = await import("./lib/posthog-logs");
  forwardConsoleToPostHog(token);
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // posthog-node needs Node; the middleware's Edge runtime is skipped.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureServerError } = await import("./lib/posthog-server");
  await captureServerError(error, request, context);
};
