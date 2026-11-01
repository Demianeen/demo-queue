import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { ORG, addProject, createEvent, setupTest } from "./behaviour.testing";

// The model is never called for real: generateText is replaced, the rest of the SDK stays.
const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));

const batches: { event: string; distinct_id: string; properties: Record<string, unknown> }[][] = [];

beforeEach(() => {
  vi.useFakeTimers();
  batches.length = 0;
  generateText.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "preview");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith("https://eu.i.posthog.com/batch/")) return new Response("not found", { status: 404 });
    batches.push(JSON.parse(String(init?.body)).batch);
    return new Response("{}", { status: 200 });
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const usage = { inputTokens: 1_000, outputTokens: 200, totalTokens: 1_200 };
const reply = (output: unknown) => ({ output, usage, totalUsage: usage, response: { id: "resp", modelId: "gpt-5.4", timestamp: new Date() } });
const neutral = { whatItDoes: "Checks agent tool calls against a policy.", howItWorks: "A TypeScript proxy.", demoFocus: "A blocked call." };
const praise = { whatItDoes: "The best policy checker for agents.", howItWorks: "A TypeScript proxy.", demoFocus: "A blocked call." };

async function summaryEvents(output: unknown[]) {
  const { t } = setupTest();
  const { eventId } = await createEvent(t);
  const submissionId = await addProject(t, eventId, 1);
  for (const item of output) generateText.mockResolvedValueOnce(reply(item));
  await t.action(internal.aiSummaryAction.generateSubmissionSummary, { submissionId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { eventId, submissionId, events: batches.flat().filter((event) => event.event === "ai_summary") };
}

test("each step of a summary run is one ai_summary event with the logged fields and the event", async () => {
  const { eventId, submissionId, events } = await summaryEvents([praise, neutral]);
  expect(events.map((event) => [event.properties.status, event.properties.reason])).toEqual([
    ["retrying", expect.stringContaining("evaluative_language")],
    ["saved", "ok"],
  ]);
  expect(events[1]).toMatchObject({
    distinct_id: "system",
    properties: {
      submission_id: submissionId, event_id: eventId, organization_id: ORG, practice: false,
      environment: "preview", surface: "system", $process_person_profile: false,
    },
  });
});

test("ai_summary events carry codes, never the project's text", async () => {
  const { events } = await summaryEvents([neutral]);
  const sent = JSON.stringify(events);
  for (const text of ["policy", "TypeScript", "Description 1", "Project 1"]) expect(sent).not.toContain(text);
});

test("a run that skips still reports why", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const { events } = await summaryEvents([]);
  expect(events.map((event) => [event.properties.status, event.properties.reason])).toEqual([["skipped", "not_configured"]]);
});
