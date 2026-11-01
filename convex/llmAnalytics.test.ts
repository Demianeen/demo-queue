// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { llmAnalytics, withoutContent } from "./llmAnalytics";

const PROMPT = "Summarise the project by jane.doe@example.com called Secret Rocket";
const sent: string[] = [];

async function bodyText(body: unknown) {
  if (typeof body === "string") return body;
  const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body as ArrayBuffer);
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString() : new TextDecoder().decode(bytes);
}

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    sent.push(await bodyText(init?.body));
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const run = () => llmAnalytics({ distinctId: "system", traceId: "trace-1", properties: { feature: "summary", event_id: "e1", practice: false } })!;

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

test("a generation sends its model, tokens and trace but no prompt or reply", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({ content: [{ type: "text", text: "Secret Rocket summary for jane.doe@example.com" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }),
  });
  await generateText({ model: run().trace(model), prompt: PROMPT });
  const body = sent.join("\n");
  expect(body).toContain("$ai_generation");
  expect(body).toContain("trace-1");
  expect(body).toContain("\"$ai_input_tokens\":120");
  expect(body).toContain("\"feature\":\"summary\"");
  for (const secret of ["jane.doe", "Secret Rocket", "$ai_input\":[", "$ai_output_choices\":["]) expect(body).not.toContain(secret);
});

test("a failed generation never sends the provider's error text", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => { throw Object.assign(new Error(`Rejected prompt: ${PROMPT}`), { statusCode: 400 }); },
  });
  await expect(generateText({ model: run().trace(model), prompt: PROMPT, maxRetries: 0 })).rejects.toThrow();
  const body = sent.join("\n");
  expect(body).toContain("\"$ai_is_error\":true");
  for (const secret of ["jane.doe", "Secret Rocket", "Rejected prompt", "$ai_error"]) expect(body).not.toContain(secret);
});

test("content fields are stripped before sending", () => {
  const event = withoutContent({ event: "$ai_generation", distinctId: "system", properties: { $ai_input: "x", $ai_error: "y", $ai_model: "gpt" } });
  expect(event?.properties).toEqual({ $ai_model: "gpt" });
});

test("nothing is traced without a token", () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "");
  expect(llmAnalytics({ distinctId: "system", traceId: "t", properties: {} })).toBeNull();
});
