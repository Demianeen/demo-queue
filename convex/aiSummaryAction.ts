"use node";

import { v, type ObjectType } from "convex/values";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import {
  buildSummaryPrompt,
  githubReadmeApiUrl,
  SUMMARY_MANIFEST_FILES,
  SUMMARY_MANIFEST_LIMIT,
  SUMMARY_README_LIMIT,
  summaryOutputSchemaFor,
  summaryReadInput,
  type ReadOutput,
  type SummaryManifest,
} from "../lib/ai-summary";

const README_TIMEOUT_MS = 8_000;
/** Proposed: a rate-limited README read is retried this many times, then the run gives up without saving. */
export const README_RETRY_LIMIT = 3;
const README_RETRY_DEFAULT_MS = 15 * 60_000;
const README_RETRY_MAX_MS = 60 * 60_000;

type ReadmeResult = { kind: "ok"; text: string | null; manifests: SummaryManifest[] } | { kind: "limited"; retryAfterMs: number };

/** How long GitHub asks us to wait, from Retry-After or the rate limit reset, within an hour. */
function retryAfterMs(response: Response) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, README_RETRY_MAX_MS);
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.min(Math.max(reset * 1000 - Date.now(), 1000), README_RETRY_MAX_MS);
  return README_RETRY_DEFAULT_MS;
}

function githubHeaders(accept: string): Record<string, string> {
  const token = env.GITHUB_TOKEN?.trim();
  return { Accept: accept, "User-Agent": "demo-queue-ai-summary", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const isRateLimited = (response: Response) => response.status === 403 || response.status === 429;

/**
 * The README of a public repository, or null, and the dependency files at its
 * root (package.json, requirements.txt, pyproject.toml) that exist. The
 * repository is checked first: a token may be able to read private
 * repositories, and nothing private may reach a summary that judges read.
 */
async function fetchReadme(githubUrl: string | null): Promise<ReadmeResult> {
  const url = githubReadmeApiUrl(githubUrl);
  const none: ReadmeResult = { kind: "ok", text: null, manifests: [] };
  if (!url) return none;
  try {
    const repository = await fetch(url.replace(/\/readme$/, ""), {
      headers: githubHeaders("application/vnd.github+json"),
      signal: AbortSignal.timeout(README_TIMEOUT_MS),
    });
    // Rate limited: try again later rather than write a summary without the README.
    if (isRateLimited(repository)) return { kind: "limited", retryAfterMs: retryAfterMs(repository) };
    if (!repository.ok) return none;
    const details = (await repository.json()) as { private?: unknown; visibility?: unknown };
    if (details.private !== false || details.visibility !== "public") return none;
    const response = await fetch(url, {
      headers: githubHeaders("application/vnd.github.raw+json"),
      signal: AbortSignal.timeout(README_TIMEOUT_MS),
    });
    if (isRateLimited(response)) return { kind: "limited", retryAfterMs: retryAfterMs(response) };
    const text = response.ok ? await response.text() : "";
    const manifests: SummaryManifest[] = [];
    for (const file of SUMMARY_MANIFEST_FILES) {
      const manifest = await fetch(url.replace(/\/readme$/, `/contents/${file}`), {
        headers: githubHeaders("application/vnd.github.raw+json"),
        signal: AbortSignal.timeout(README_TIMEOUT_MS),
      });
      if (isRateLimited(manifest)) return { kind: "limited", retryAfterMs: retryAfterMs(manifest) };
      // A missing file is a 404: the project simply has none.
      const content = manifest.ok ? await manifest.text() : "";
      if (content.trim()) manifests.push({ file, text: content.slice(0, SUMMARY_MANIFEST_LIMIT) });
    }
    return { kind: "ok", text: text.trim() ? text.slice(0, SUMMARY_README_LIMIT) : null, manifests };
  } catch {
    return none;
  }
}

/** The read as saveSummary takes it, or nothing when the model was not asked for one. */
function readFrom(output: ReadOutput) {
  if (output.overall === undefined) return undefined;
  return { overall: output.overall, tracks: output.trackFit ?? [], sponsors: output.sponsorUse ?? [] };
}

function log(status: string, reason: string) {
  // Never the project text, the README or the key.
  console.log(JSON.stringify({ event: "ai-summary", status, reason }));
}

const summaryRunArgs = {
  submissionId: v.id("submissions"),
  refreshReadme: v.optional(v.boolean()),
  contextChanged: v.optional(v.boolean()),
  readmeAttempt: v.optional(v.number()),
  // When this run was queued to start; it clears the submission's pending marker when it ends.
  queuedFor: v.optional(v.number()),
};

/**
 * Writes the summary, one line per section, for one submission with the deployment's
 * existing OpenAI setup (OPENAI_API_KEY, OPENAI_MODEL). Without a key, it is
 * skipped and logged. A failure is logged and leaves any older summary alone.
 */
export const generateSubmissionSummary = internalAction({
  args: summaryRunArgs,
  handler: async (ctx, args): Promise<{ saved: boolean }> => {
    let retriesLater = false;
    try {
      const result = await writeSummary(ctx, args);
      retriesLater = result.retriesLater === true;
      return { saved: result.saved };
    } finally {
      // However the run ends, except when it retries later, judges stop seeing the read as being checked.
      if (!retriesLater && args.queuedFor !== undefined) {
        await ctx.runMutation(internal.aiSummaries.endSummaryRun, { submissionId: args.submissionId, queuedFor: args.queuedFor });
      }
    }
  },
});

async function writeSummary(ctx: ActionCtx, args: ObjectType<typeof summaryRunArgs>): Promise<{ saved: boolean; retriesLater?: boolean }> {
  const input = await ctx.runQuery(internal.aiSummaries.summaryInput, { submissionId: args.submissionId, refreshReadme: args.refreshReadme, contextChanged: args.contextChanged });
  if (!input) {
    log("skipped", "not_needed");
    return { saved: false };
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    log("skipped", "not_configured");
    return { saved: false };
  }
  const fetched = await fetchReadme(input.githubUrl);
  if (fetched.kind === "limited") {
    const attempt = (args.readmeAttempt ?? 0) + 1;
    if (attempt > README_RETRY_LIMIT) {
      log("skipped", "readme_rate_limited");
      await ctx.runMutation(internal.aiSummaries.markSummaryGaveUp, { submissionId: args.submissionId, sourceKey: input.sourceKey, reason: "readme_rate_limited" });
      return { saved: false };
    }
    await ctx.scheduler.runAfter(fetched.retryAfterMs, internal.aiSummaryAction.generateSubmissionSummary, {
      submissionId: args.submissionId,
      ...(args.refreshReadme ? { refreshReadme: true } : {}),
      ...(args.contextChanged ? { contextChanged: true } : {}),
      ...(args.queuedFor !== undefined ? { queuedFor: args.queuedFor } : {}),
      readmeAttempt: attempt,
    });
    log("deferred", "readme_rate_limited");
    return { saved: false, retriesLater: true };
  }
  const readme = fetched.text;
  const manifests = fetched.manifests;
  const read = summaryReadInput(input.tracks, input.sponsors);
  const readmeHash = readme === null ? undefined : createHash("sha256").update(readme).digest("hex");
  // The description and repository are unchanged: write again only when the README changed.
  if (input.readmeCheckOnly && (readmeHash ?? null) === input.readmeHash) {
    log("skipped", "readme_unchanged");
    return { saved: false };
  }
  const model = env.OPENAI_MODEL ?? "gpt-5.4";
  const giveUp = (reason: string) =>
    ctx.runMutation(internal.aiSummaries.markSummaryGaveUp, { submissionId: args.submissionId, sourceKey: input.sourceKey, reason });
  // Proposed: when the language check rejects a summary, try once more with a stricter instruction.
  for (const stricter of [false, true]) {
    const { system, prompt } = buildSummaryPrompt({ ...input, readme, manifests }, input.sections, { stricter });
    let result: { saved: boolean; reason: string };
    try {
      // Exactly one capped string per section; anything else fails here and is logged.
      const { output } = await generateText({
        model: createOpenAI({ apiKey })(model),
        output: Output.object({ schema: summaryOutputSchemaFor(input.sections, read) }),
        system,
        prompt,
      });
      result = await ctx.runMutation(internal.aiSummaries.saveSummary, {
        submissionId: args.submissionId,
        sourceKey: input.sourceKey,
        lines: input.sections.map((section) => ({ key: section.key, text: String((output as Record<string, unknown>)[section.key] ?? "") })),
        tracksKey: input.tracksKey,
        read: readFrom(output as ReadOutput),
        model,
        usedReadme: readme !== null,
        readmeHash,
      });
    } catch (error) {
      log("failed", error instanceof Error ? error.name : "unknown");
      await giveUp("model_failed");
      return { saved: false };
    }
    if (result.saved) {
      log("saved", result.reason);
      return { saved: true };
    }
    if (!stricter && result.reason.startsWith("evaluative_language")) {
      log("retrying", result.reason);
      continue;
    }
    log("rejected", result.reason);
    // A newer run covers changed fields; anything else is final for these fields.
    if (result.reason !== "source_changed" && result.reason !== "sample_mode") await giveUp(result.reason);
    return { saved: false };
  }
  return { saved: false };
}
