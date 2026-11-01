"use node";

import { withTracing } from "@posthog/ai/vercel";
import { PostHog, type EventMessage } from "posthog-node";
import { env } from "./_generated/server";

/**
 * Fields of an `$ai_generation` that can hold prompt or reply text. Privacy
 * mode empties the first two; the others it leaves alone (`$ai_error` is the
 * provider's error, which can quote the prompt), so they are removed here.
 */
const CONTENT_PROPERTIES = ["$ai_input", "$ai_output_choices", "$ai_error", "$ai_tools", "$ai_provider_metadata", "$ai_model_parameters"];

export function withoutContent(event: EventMessage | null): EventMessage | null {
  if (!event?.properties) return event;
  for (const key of CONTENT_PROPERTIES) delete event.properties[key];
  return event;
}

type Model = Parameters<typeof withTracing>[0];

/**
 * LLM analytics for one action run: model, tokens, cost and latency of each
 * OpenAI call, never its prompt or reply. Null without a PostHog token. Each
 * call's event is sent before the call returns, so nothing is left to flush.
 */
export function llmAnalytics(run: { distinctId: string; traceId: string; properties: Record<string, string | boolean> }) {
  const token = env.POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return null;
  const client = new PostHog(token, {
    host: env.POSTHOG_HOST?.trim() || "https://eu.i.posthog.com",
    privacyMode: true,
    flushAt: 1,
    flushInterval: 0,
    // Each event is sent inside the model call, so a slow PostHog must not hold it up.
    fetchRetryCount: 0,
    requestTimeout: 2000,
    before_send: withoutContent,
  });
  return {
    trace: <M extends Model>(model: M): M => withTracing(model, client, {
      posthogDistinctId: run.distinctId,
      posthogTraceId: run.traceId,
      posthogProperties: {
        ...run.properties,
        environment: env.POSTHOG_ENVIRONMENT?.trim() || "development",
        ...(run.distinctId === "system" ? { $process_person_profile: false } : {}),
      },
      // @posthog/ai reads `client.privacy_mode`, which posthog-node does not set, so the
      // client's privacyMode alone is not enough.
      posthogPrivacyMode: true,
      posthogCaptureImmediate: true,
    }),
  };
}
