"use node";

import { v } from "convex/values";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";
import {
  buildSummaryPrompt,
  githubReadmeApiUrl,
  SUMMARY_README_LIMIT,
  summaryOutputSchema,
} from "../lib/ai-summary";

const README_TIMEOUT_MS = 8_000;

async function fetchReadme(githubUrl: string | null) {
  const url = githubReadmeApiUrl(githubUrl);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "demo-queue-ai-summary" },
      signal: AbortSignal.timeout(README_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.trim() ? text.slice(0, SUMMARY_README_LIMIT) : null;
  } catch {
    return null;
  }
}

function log(status: string, reason: string) {
  // Never the project text, the README or the key.
  console.log(JSON.stringify({ event: "ai-summary", status, reason }));
}

/**
 * Writes the three-line summary for one submission with the deployment's
 * existing OpenAI setup (OPENAI_API_KEY, OPENAI_MODEL). Without a key, it is
 * skipped and logged. A failure is logged and leaves any older summary alone.
 */
export const generateSubmissionSummary = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args): Promise<{ saved: boolean }> => {
    const input = await ctx.runQuery(internal.aiSummaries.summaryInput, { submissionId: args.submissionId });
    if (!input) {
      log("skipped", "not_needed");
      return { saved: false };
    }
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      log("skipped", "not_configured");
      return { saved: false };
    }
    const readme = await fetchReadme(input.githubUrl);
    const { system, prompt } = buildSummaryPrompt({ ...input, readme });
    const model = env.OPENAI_MODEL ?? "gpt-5.4";
    try {
      // Exactly three capped strings; anything else fails here and is logged.
      const { output } = await generateText({
        model: createOpenAI({ apiKey })(model),
        output: Output.object({ schema: summaryOutputSchema }),
        system,
        prompt,
      });
      const result = await ctx.runMutation(internal.aiSummaries.saveSummary, {
        submissionId: args.submissionId,
        sourceKey: input.sourceKey,
        whatItDoes: output.whatItDoes,
        howItWorks: output.howItWorks,
        demoFocus: output.demoFocus,
        model,
        usedReadme: readme !== null,
        readmeHash: readme === null ? undefined : createHash("sha256").update(readme).digest("hex"),
      });
      log(result.saved ? "saved" : "rejected", result.reason);
      return { saved: result.saved };
    } catch (error) {
      log("failed", error instanceof Error ? error.name : "unknown");
      return { saved: false };
    }
  },
});
