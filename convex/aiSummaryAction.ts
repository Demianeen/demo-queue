"use node";

import { v, type ObjectType } from "convex/values";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api";
import { logAiUsage } from "./aiUsage";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import {
  buildSummaryPrompt,
  githubReadmeApiUrl,
  SUMMARY_MANIFEST_FILES,
  SUMMARY_MANIFEST_LIMIT,
  SUMMARY_README_LIMIT,
  readFromOutput,
  summaryOutputSchemaFor,
  summaryReadInput,
  type ReadOutput,
  type SummaryManifest,
} from "../lib/ai-summary";
import { hasTokens, usageFromError, usageFromResult, type AiUsageResult, type LoggedUsage } from "../lib/ai-usage";
import { fetchCode, inputChanged, type CodeResult } from "../lib/ai-summary-inputs";

const README_TIMEOUT_MS = 8_000;
/** A public repository's coordinates, for the code read. */
type PublicRepository = { owner: string; name: string; defaultBranch: string };
/**
 * repository is set only for a public repository with a default branch.
 * githubLimited says a later GitHub call (a dependency file) was rate limited,
 * or GitHub said no calls are left: the code read is then skipped.
 */
type ReadmeResult =
  | { kind: "ok"; text: string | null; manifests: SummaryManifest[]; repository: PublicRepository | null; githubLimited: boolean }
  | { kind: "limited" };

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
  const none: ReadmeResult = { kind: "ok", text: null, manifests: [], repository: null, githubLimited: false };
  if (!url) return none;
  try {
    const repository = await fetch(url.replace(/\/readme$/, ""), {
      headers: githubHeaders("application/vnd.github+json"),
      signal: AbortSignal.timeout(README_TIMEOUT_MS),
    });
    if (isRateLimited(repository)) return { kind: "limited" };
    if (!repository.ok) return none;
    const details = (await repository.json()) as { private?: unknown; visibility?: unknown; default_branch?: unknown };
    if (details.private !== false || details.visibility !== "public") return none;
    const [owner, name] = new URL(url).pathname.split("/").slice(2, 4).map(decodeURIComponent);
    const publicRepository = typeof details.default_branch === "string" && details.default_branch ? { owner, name, defaultBranch: details.default_branch } : null;
    const response = await fetch(url, {
      headers: githubHeaders("application/vnd.github.raw+json"),
      signal: AbortSignal.timeout(README_TIMEOUT_MS),
    });
    if (isRateLimited(response)) return { kind: "limited" };
    const text = response.ok ? await response.text() : "";
    const manifests: SummaryManifest[] = [];
    let githubLimited = response.headers.get("x-ratelimit-remaining") === "0";
    // Dependency files only add to a README; without one, save the requests.
    for (const file of text.trim() ? SUMMARY_MANIFEST_FILES : []) {
      const manifest = await fetch(url.replace(/\/readme$/, `/contents/${file}`), {
        headers: githubHeaders("application/vnd.github.raw+json"),
        signal: AbortSignal.timeout(README_TIMEOUT_MS),
      });
      if (isRateLimited(manifest)) {
        githubLimited = true;
        break;
      }
      githubLimited = manifest.headers.get("x-ratelimit-remaining") === "0";
      // A missing file is a 404: the project simply has none.
      const content = manifest.ok ? await manifest.text() : "";
      if (content.trim()) manifests.push({ file, text: content.slice(0, SUMMARY_MANIFEST_LIMIT) });
    }
    return { kind: "ok", text: text.trim() ? text.slice(0, SUMMARY_README_LIMIT) : null, manifests, repository: publicRepository, githubLimited };
  } catch {
    return none;
  }
}

// TODO(posthog): send these ai-summary events to PostHog too, with the same fields.
function log(status: string, reason: string, extra: { error?: string; statusCode?: number; errorType?: string; errorCode?: string } = {}) {
  // Never the project text, the README, a URL or the key.
  console.log(JSON.stringify({ event: "ai-summary", status, reason, ...extra }));
}

/** A short code from the API, like "invalid_request_error": anything longer or freer could be text. */
const apiCode = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined);

/**
 * What a failed model call says about why: the error's name, the HTTP status
 * and the API's error type and code when it gave them. Never the message or
 * the response body, which can quote the prompt. After retries, the AI SDK
 * wraps the last call's error, so that one is read.
 */
function modelErrorFields(error: unknown) {
  if (!(error instanceof Error)) return { error: "unknown" };
  const last = (error as { lastError?: unknown }).lastError;
  const call = (last instanceof Error ? last : error) as { statusCode?: unknown; data?: unknown; responseBody?: unknown };
  let body = call.data;
  if (body === undefined && typeof call.responseBody === "string") {
    try { body = JSON.parse(call.responseBody); } catch { body = undefined; }
  }
  const detail = (body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : undefined) as { type?: unknown; code?: unknown } | undefined;
  return {
    error: error.name,
    ...(typeof call.statusCode === "number" ? { statusCode: call.statusCode } : {}),
    ...(apiCode(detail?.type) ? { errorType: apiCode(detail?.type) } : {}),
    ...(apiCode(detail?.code) ? { errorCode: apiCode(detail?.code) } : {}),
  };
}

// TODO(posthog): send these input failures to PostHog too; they are ai-summary events.
function logInputFailure(status: string, reason: string | null) {
  // A reason code only: never a repository path, file text or a token.
  if (reason) log(status, reason);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The code read for the prompt, and the hash the summary keeps: of the read,
 * "none" when there is nothing to read, or null when it failed or was not
 * tried, so a failed read never counts as a change.
 */
function codeInput(result: CodeResult | null) {
  if (result === null) return { code: null, hash: null };
  if (result.kind === "none") return { code: null, hash: "none" };
  if (result.kind === "failed") {
    logInputFailure("without_code", result.reason);
    return { code: null, hash: null };
  }
  if (result.fileFailures > 0) logInputFailure("partial_code", "code_file_failed");
  const code = { files: result.files, total: result.total, excerpts: result.excerpts };
  return { code, hash: sha256(JSON.stringify(code)) };
}

/**
 * The code read, only after a README read that was not rate limited, so the
 * shared GitHub limit goes to READMEs first. null when it was not tried.
 */
async function readCode(fetched: ReadmeResult): Promise<CodeResult | null> {
  if (fetched.kind !== "ok") return null;
  if (!fetched.repository) return { kind: "none" };
  if (fetched.githubLimited) return { kind: "failed", reason: "code_rate_limited" };
  const token = env.GITHUB_TOKEN?.trim();
  return fetchCode(fetched.repository, { headers: { "User-Agent": "demo-queue-ai-summary", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

const summaryRunArgs = {
  submissionId: v.id("submissions"),
  refreshReadme: v.optional(v.boolean()),
  contextChanged: v.optional(v.boolean()),
  // Unused: runs queued before README reads stopped retrying still carry it.
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
    try {
      return await writeSummary(ctx, args);
    } finally {
      // However the run ends, judges stop seeing the read as being checked.
      if (args.queuedFor !== undefined) {
        await ctx.runMutation(internal.aiSummaries.endSummaryRun, { submissionId: args.submissionId, queuedFor: args.queuedFor });
      }
    }
  },
});

async function writeSummary(ctx: ActionCtx, args: ObjectType<typeof summaryRunArgs>): Promise<{ saved: boolean }> {
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
  // The code is read after the README. Neither throws.
  const fetched = await fetchReadme(input.githubUrl);
  const codeRead = await readCode(fetched);
  // GitHub rate limited the README read. A summary that only waited on a README
  // check stays as it is; a new one is written now without the README, so judges
  // are not left waiting. The next close reads the README again.
  if (fetched.kind === "limited" && input.readmeCheckOnly) {
    log("skipped", "readme_rate_limited");
    return { saved: false };
  }
  if (fetched.kind === "limited") log("without_readme", "readme_rate_limited");
  const readme = fetched.kind === "ok" ? fetched.text : null;
  const manifests = fetched.kind === "ok" ? fetched.manifests : [];
  const read = summaryReadInput(input.tracks, input.sponsors);
  const readmeHash = readme === null ? undefined : sha256(readme);
  const { code, hash: codeHash } = codeInput(codeRead);
  // The description and repository are unchanged: write again only when the README or code
  // changed. A summary from before the code read existed is not rewritten for it.
  const changed = (readmeHash ?? null) !== input.readmeHash || inputChanged(input.codeHash, codeHash);
  if (input.readmeCheckOnly && !changed) {
    log("skipped", "readme_unchanged");
    return { saved: false };
  }
  const model = env.OPENAI_MODEL ?? "gpt-5.4";
  const giveUp = (reason: string) =>
    ctx.runMutation(internal.aiSummaries.markSummaryGaveUp, { submissionId: args.submissionId, sourceKey: input.sourceKey, reason });
  // Proposed: when the language check rejects a summary, try once more with a stricter instruction.
  // Every call is logged with its tokens, whatever happens to its output: OpenAI bills them all.
  const logCall = (usage: LoggedUsage, result: AiUsageResult) =>
    logAiUsage(ctx, { ...usage, eventId: input.eventId, submissionId: args.submissionId, feature: "summary", result });
  for (const stricter of [false, true]) {
    const { system, prompt } = buildSummaryPrompt({ ...input, readme, manifests, code }, input.sections, { stricter });
    let usage: LoggedUsage | null = null;
    let stage: "call" | "output" | "save" = "call";
    let result: { saved: boolean; reason: string };
    try {
      // Exactly one capped string per section; anything else fails here and is logged.
      const response = await generateText({
        model: createOpenAI({ apiKey })(model),
        output: Output.object({ schema: summaryOutputSchemaFor(input.sections, read) }),
        system,
        prompt,
      });
      usage = usageFromResult(response, model);
      stage = "output";
      const output = response.output;
      stage = "save";
      result = await ctx.runMutation(internal.aiSummaries.saveSummary, {
        submissionId: args.submissionId,
        sourceKey: input.sourceKey,
        lines: input.sections.map((section) => ({ key: section.key, text: String((output as Record<string, unknown>)[section.key] ?? "") })),
        tracksKey: input.tracksKey,
        read: readFromOutput(output as ReadOutput),
        model,
        usedReadme: readme !== null,
        readmeHash,
        // What the model saw: a hash, or "none" when it had no code.
        codeHash: codeHash ?? "none",
      });
    } catch (error) {
      log("failed", "model_failed", modelErrorFields(error));
      // A reply that did not match the schema still reports its usage; a failed request does not.
      const known = usage ?? usageFromError(error, model);
      const unusable = stage === "output" || (stage === "call" && hasTokens(known));
      await logCall(known, unusable ? "failed" : "error");
      await giveUp("model_failed");
      return { saved: false };
    }
    const logged: LoggedUsage = usage ?? { model };
    if (result.saved) {
      log("saved", result.reason);
      await logCall(logged, "saved");
      return { saved: true };
    }
    if (!stricter && result.reason.startsWith("evaluative_language")) {
      log("retrying", result.reason);
      await logCall(logged, "retried");
      continue;
    }
    log("rejected", result.reason);
    // A newer run covers changed fields; anything else is final for these fields.
    const superseded = result.reason === "source_changed" || result.reason === "sample_mode";
    await logCall(logged, superseded ? "discarded" : "rejected");
    if (!superseded) await giveUp(result.reason);
    return { saved: false };
  }
  return { saved: false };
}
