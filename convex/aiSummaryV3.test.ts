import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import tableHistorySchema from "../node_modules/@convex-dev/table-history/src/component/schema";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { REGENERATE_DAILY_LIMIT } from "./aiSummaries";

// The model is never called for real: generateText is replaced, the rest of the SDK stays.
const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));

const tableHistoryComponentRoot = "../node_modules/@convex-dev/table-history/src/component";
const tableHistoryModules = {
  "./_generated/api.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/api.ts`),
  "./_generated/server.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/server.ts`),
  "./lib.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/lib.ts`),
};
const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./tracks.ts": () => import("./tracks"),
  "./sponsors.ts": () => import("./sponsors"),
  "./aiSummaries.ts": () => import("./aiSummaries"),
  "./aiSummaryAction.ts": () => import("./aiSummaryAction"),
  "./aiUsage.ts": () => import("./aiUsage"),
  "./phases.ts": () => import("./phases"),
  "./changeLog.ts": () => import("./changeLog"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
};

const NOW = Date.parse("2026-11-01T18:00:00Z");

/** A public repository with three commits, one of them after the deadline, and two source files. */
function github(url: string) {
  const address = String(url);
  if (address.endsWith("/repos/example/guardrail")) return Response.json({ private: false, visibility: "public", default_branch: "main" });
  if (address.includes("/commits?per_page=100&page=1")) {
    return Response.json([
      { sha: "late", commit: { committer: { date: "2026-11-01T19:00:00Z" }, message: "LATE_COMMIT" }, author: { login: "sam" } },
      { sha: "s2", commit: { committer: { date: "2026-11-01T15:00:00Z" }, message: "add policy" }, author: { login: "lee" } },
      { sha: "s1", commit: { committer: { date: "2026-11-01T10:00:00Z" }, message: "start" }, author: { login: "sam" } },
    ]);
  }
  if (address.endsWith("/commits/s1")) return Response.json({ files: [] });
  if (address.includes("/git/trees/s2?recursive=1")) return Response.json({ tree: [{ path: "src/index.ts", type: "blob", size: 40 }] });
  if (address.endsWith("/readme?ref=s2")) return new Response("# Guardrail");
  if (address.endsWith("/s2/src/index.ts")) return new Response("export const proxy = 1;");
  if (address.endsWith("/repos/example/guardrail/readme")) return new Response("# Guardrail");
  return new Response("Not found", { status: 404 });
}

const V3_OUTPUT = {
  whatItDoes: "Checks agent tool calls against a policy before they run.",
  howItWorks: "A TypeScript proxy in src/index.ts sits between the agent and its tools.",
  builtVsStubbed: [{ part: "Policy check", status: "working", evidence: "src/index.ts exports the proxy." }, { part: "Dashboard", status: "teleported", evidence: "x" }],
  demoFocus: "Watch a blocked call; a fixed reason every time would suggest it is scripted.",
  questions: ["Which policies run live, and which are hard-coded?", "What did you build before the event?"],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  generateText.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  fetchMock = vi.fn(async (url: string) => github(url));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(count = 1) {
  const root = convexTest(schema, modules);
  root.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  rateLimiterTest.register(root);
  const t = root.withIdentity({ subject: "operator", org_id: "org_ai" });
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "Hack", slug: "hack", eventType: "hackathon", workosOrganizationId: "org_ai",
    meetUrl: "https://meet.example", queuePublished: false, createdAt: 1, updatedAt: 1,
    submissionsClosedAt: Date.parse("2026-11-01T18:00:00Z"),
  }));
  const ids: Id<"submissions">[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await t.run((ctx) => ctx.db.insert("submissions", {
      eventId, participantToken: `p-${index}`, name: `Person ${index}`, email: `person${index}@example.com`, phone: "+440000000000",
      demoTitle: index === 0 ? "Guardrail" : `Demo ${index}`, description: `Description ${index}`,
      githubUrl: index === 0 ? "https://github.com/example/guardrail" : undefined,
      status: "candidate", createdAt: 1, updatedAt: 1,
    })));
  }
  const runAll = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const summary = (id: (typeof ids)[number]) => t.run(async (ctx) => (await ctx.db.get(id))!.aiSummary ?? null);
  return { t, eventId, ids, runAll, summary };
}

test("a v3 summary reads the code at the deadline and saves the build facts, parts and questions", async () => {
  generateText.mockResolvedValue({ output: V3_OUTPUT });
  const { t, ids, runAll, summary } = await setup();
  await t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" });
  await runAll();

  expect(generateText).toHaveBeenCalledTimes(1);
  const call = generateText.mock.calls[0][0];
  expect(call.providerOptions).toEqual({ openai: { reasoningEffort: "medium", forceReasoning: true } });
  expect(call.prompt).toContain("<<<BEGIN COMMIT MESSAGES>>>");
  expect(call.prompt).not.toContain("LATE_COMMIT");
  expect(`${call.system}\n${call.prompt}`).not.toMatch(/Person \d|@example\.com|\+44|\bsam\b|\blee\b/);
  expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes("/late"))).toBe(false);

  const saved = (await summary(ids[0]))!;
  expect(saved).toMatchObject({
    model: "gpt-6.1-sol",
    codeHash: "v3:s2",
    usedReadme: true,
    howItWorks: V3_OUTPUT.howItWorks,
    // The unknown status is left out.
    builtVsStubbed: [{ part: "Policy check", status: "working", evidence: "src/index.ts exports the proxy." }],
    questions: V3_OUTPUT.questions,
    build: { sha: "s2", commits: 2, people: 2, afterDeadline: 1, firstCommitLines: 0, deadlineKind: "closed", filesRead: 1 },
  });
});

test("a failed v3 call falls back to today's v2 summary instead of nothing", async () => {
  generateText.mockImplementation(async (options: { providerOptions?: unknown }) => {
    if (options.providerOptions) throw new Error("model not found");
    return { output: { whatItDoes: "Checks tool calls.", howItWorks: "A proxy.", demoFocus: "A blocked call." } };
  });
  const { t, ids, runAll, summary } = await setup();
  await t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" });
  await runAll();
  expect(generateText).toHaveBeenCalledTimes(2);
  expect(await summary(ids[0])).toMatchObject({ model: "gpt-5.4", whatItDoes: "Checks tool calls." });
  expect((await summary(ids[0]))!.build).toBeUndefined();
});

test("v3 output that praises the project is retried, then falls back to v2", async () => {
  generateText.mockImplementation(async (options: { providerOptions?: unknown }) => options.providerOptions
    ? { output: { ...V3_OUTPUT, questions: ["Why is this the best project here?", "What is live?"] } }
    : { output: { whatItDoes: "Checks tool calls.", howItWorks: "A proxy.", demoFocus: "A blocked call." } });
  const { t, ids, runAll, summary } = await setup();
  await t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" });
  await runAll();
  expect(generateText).toHaveBeenCalledTimes(3);
  expect(await summary(ids[0])).toMatchObject({ model: "gpt-5.4" });
});

test("regenerate queues every project in judging, reports progress and has its own daily limit", async () => {
  generateText.mockImplementation(async (options: { providerOptions?: unknown }) => options.providerOptions
    ? { output: V3_OUTPUT }
    : { output: { whatItDoes: "A demo.", howItWorks: "Code.", demoFocus: "The demo." } });
  const { t, runAll } = await setup(3);
  expect(await t.query(api.aiSummaries.eventSummaryRegeneration, { slug: "hack" })).toMatchObject({ projects: 3, configured: true, estimateUsd: expect.closeTo(0.51, 5), leftToday: REGENERATE_DAILY_LIMIT, progress: null });

  expect(await t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" })).toEqual({ queued: 3 });
  expect((await t.query(api.aiSummaries.eventSummaryRegeneration, { slug: "hack" }))!.progress).toMatchObject({ total: 3, done: 0, pending: 3, failed: 0, running: true });
  await expect(t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" })).rejects.toThrow("already being regenerated");

  await runAll();
  expect((await t.query(api.aiSummaries.eventSummaryRegeneration, { slug: "hack" }))!.progress).toMatchObject({ total: 3, done: 3, pending: 0, failed: 0, running: false });

  for (let run = 1; run < REGENERATE_DAILY_LIMIT; run += 1) {
    vi.advanceTimersByTime(60_000);
    await t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" });
    await runAll();
  }
  await expect(t.mutation(api.aiSummaries.regenerateEventSummaries, { slug: "hack" })).rejects.toThrow("times a day");
  // Other organisations cannot see or start it.
  const outsider = convexTest(schema, modules).withIdentity({ subject: "x", org_id: "org_other" });
  await expect(outsider.query(api.aiSummaries.eventSummaryRegeneration, { slug: "hack" })).rejects.toThrow();
});
