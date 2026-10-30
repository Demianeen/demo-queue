/**
 * OpenAI list prices for the models the app calls, in USD per 1M tokens.
 *
 * Cost is worked out when usage is read, never stored, so correcting a price
 * here corrects every month already logged. Each model keeps a list of prices
 * with the date they apply from; a call uses the newest entry that started on
 * or before the day it was made. A model without an entry has no price, and
 * the AI usage page shows "price unknown" for its calls.
 *
 * Source: https://developers.openai.com/api/docs/pricing and the model pages,
 * Standard tier, checked 30 Oct 2026.
 */
export type TokenPrices = { input: number; cachedInput: number; output: number };
export type ModelPrice = TokenPrices & {
  /** The UTC day (YYYY-MM-DD) this price applies from. */
  from: string;
  /** OpenAI prices a whole call at a higher rate once its input passes this many tokens. */
  longContext?: TokenPrices & { aboveInputTokens: number };
};

export const PRICES_CHECKED = "30 Oct 2026";

export const AI_PRICES: Record<string, ModelPrice[]> = {
  // gpt-5.4-2026-03-05 is the snapshot behind the alias.
  "gpt-5.4": [{
    from: "2026-03-05", input: 2.5, cachedInput: 0.25, output: 15,
    longContext: { aboveInputTokens: 272_000, input: 5, cachedInput: 0.5, output: 22.5 },
  }],
};

/** "gpt-5.4-2026-03-05" is priced as "gpt-5.4"; "gpt-5.4-mini" stays itself. */
export function priceModelKey(model: string) {
  return model.trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The price that applied to a call to `model` at `at`, or null when the app has none. */
export function priceFor(model: string, at: number, prices: Record<string, ModelPrice[]> = AI_PRICES): ModelPrice | null {
  const entries = prices[priceModelKey(model)];
  if (!entries) return null;
  const day = dayOf(at);
  let match: ModelPrice | null = null;
  for (const entry of entries) {
    if (entry.from <= day && (!match || entry.from > match.from)) match = entry;
  }
  return match;
}

export type UsageForCost = {
  model: string;
  serviceTier?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  createdAt: number;
};

export type CallCost =
  | { kind: "priced"; usd: number }
  /** The call logged no tokens (it failed before OpenAI reported usage): nothing to price. */
  | { kind: "no_usage" }
  /** Tokens are known but the app has no price for this model or service tier. */
  | { kind: "unknown"; reason: "model" | "service_tier" };

/** Tiers priced at the Standard list price. Flex and Priority have their own prices, not kept here. */
const STANDARD_TIERS = new Set(["default", "auto", "standard"]);

/**
 * The estimated cost of one call. Input is split into uncached and cached
 * tokens. Reasoning tokens are billed as output and OpenAI already counts them
 * inside outputTokens, so they are never added again.
 */
export function callCost(call: UsageForCost, prices: Record<string, ModelPrice[]> = AI_PRICES): CallCost {
  if (call.inputTokens === undefined && call.outputTokens === undefined) return { kind: "no_usage" };
  if (call.serviceTier && !STANDARD_TIERS.has(call.serviceTier)) return { kind: "unknown", reason: "service_tier" };
  const price = priceFor(call.model, call.createdAt, prices);
  if (!price) return { kind: "unknown", reason: "model" };
  const input = Math.max(0, call.inputTokens ?? 0);
  const cached = Math.min(input, Math.max(0, call.cachedInputTokens ?? 0));
  const output = Math.max(0, call.outputTokens ?? 0);
  const rate = price.longContext && input > price.longContext.aboveInputTokens ? price.longContext : price;
  const usd = ((input - cached) * rate.input + cached * rate.cachedInput + output * rate.output) / 1_000_000;
  return { kind: "priced", usd };
}
