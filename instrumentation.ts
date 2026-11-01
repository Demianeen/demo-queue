import type { Instrumentation } from "next";

export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // posthog-node needs Node; the middleware's Edge runtime is skipped.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureServerError } = await import("./lib/posthog-server");
  await captureServerError(error, request, context);
};
