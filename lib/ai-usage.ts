/**
 * AI usage logging: what one OpenAI call used, read from the AI SDK's result
 * or from the error it threw, and the month a usage page shows.
 * Never the prompt, the project text or the model's output.
 */

export const AI_USAGE_FEATURES = ["summary", "shuffle"] as const;
export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

/**
 * How a call ended. Every one of them is logged, because OpenAI bills a call
 * whose output was rejected or thrown away just the same.
 * - saved: the summary was saved, or the shuffled lineup was used.
 * - retried: the summary failed the language check and was tried again.
 * - rejected: the summary failed the checks and the run gave up.
 * - discarded: the project changed while the model wrote, so a newer run covers it.
 * - failed: the model answered, but not with output the app could use.
 * - error: the call or the save threw; tokens only when OpenAI reported them.
 */
export const AI_USAGE_RESULTS = ["saved", "retried", "rejected", "discarded", "failed", "error"] as const;
export type AiUsageResult = (typeof AI_USAGE_RESULTS)[number];

export type LoggedUsage = {
  model: string;
  serviceTier?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

type SdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
  /** Older field names, still set by AI SDK 6. */
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

function fromParts(requestedModel: string, usage: unknown, response: unknown, providerMetadata: unknown): LoggedUsage {
  const sdk = (record(usage) ?? {}) as SdkUsage;
  const modelId = record(response)?.modelId;
  const tier = record(record(providerMetadata)?.openai)?.serviceTier;
  const logged: LoggedUsage = { model: typeof modelId === "string" && modelId.trim() ? modelId.trim() : requestedModel };
  if (typeof tier === "string" && tier) logged.serviceTier = tier;
  const input = count(sdk.inputTokens);
  const cached = count(sdk.inputTokenDetails?.cacheReadTokens) ?? count(sdk.cachedInputTokens);
  const output = count(sdk.outputTokens);
  const reasoning = count(sdk.outputTokenDetails?.reasoningTokens) ?? count(sdk.reasoningTokens);
  if (input !== undefined) logged.inputTokens = input;
  if (cached !== undefined) logged.cachedInputTokens = cached;
  if (output !== undefined) logged.outputTokens = output;
  if (reasoning !== undefined) logged.reasoningTokens = reasoning;
  return logged;
}

/**
 * Usage from a generateText result: tokens summed over its steps, the model
 * OpenAI says answered, and the service tier from OpenAI's provider metadata.
 */
export function usageFromResult(result: unknown, requestedModel: string): LoggedUsage {
  const value = record(result) ?? {};
  return fromParts(requestedModel, value.totalUsage ?? value.usage, value.response, value.providerMetadata);
}

/**
 * Usage from an error generateText threw. The AI SDK's NoObjectGeneratedError
 * carries the usage of a reply that did not match the schema; a network or API
 * error carries none, and only the requested model is known.
 */
export function usageFromError(error: unknown, requestedModel: string): LoggedUsage {
  const value = record(error) ?? {};
  return fromParts(requestedModel, value.usage, value.response, undefined);
}

export const hasTokens = (usage: Pick<LoggedUsage, "inputTokens" | "outputTokens">) =>
  usage.inputTokens !== undefined || usage.outputTokens !== undefined;

/** A month as "YYYY-MM", UTC. */
export type UsageMonth = { year: number; month: number };

export function parseUsageMonth(value: string | null | undefined): UsageMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

export const usageMonthKey = ({ year, month }: UsageMonth) => `${year}-${String(month).padStart(2, "0")}`;

export function usageMonthOf(at: number): UsageMonth {
  const date = new Date(at);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** The month's first instant and the next month's, in UTC milliseconds. */
export function usageMonthRange({ year, month }: UsageMonth) {
  return { start: Date.UTC(year, month - 1, 1), end: Date.UTC(year, month, 1) };
}

export function usageMonthDays(month: UsageMonth) {
  const { start, end } = usageMonthRange(month);
  return Math.round((end - start) / 86_400_000);
}

export function usageMonthLabel({ year, month }: UsageMonth) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** This month and the eleven before it, newest first. */
export function recentUsageMonths(now: number, count = 12): UsageMonth[] {
  const current = usageMonthOf(now);
  return Array.from({ length: count }, (_, index) => {
    const offset = current.year * 12 + (current.month - 1) - index;
    return { year: Math.floor(offset / 12), month: (offset % 12) + 1 };
  });
}
