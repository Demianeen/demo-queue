import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACTOR_SUBJECT, ORG, addProject, createEvent, setupTest, type TestClient } from "./behaviour.testing";
import { aiSummaryStatus, publicAiRead, publicAiSummary } from "./aiSummaries";
import { buildSampleSummary } from "../lib/ai-summary";

// The model is never called for real: generateText is replaced, the rest of the SDK stays.
const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
  generateText.mockReset();
  generateText.mockImplementation(async () => ({
    output: { whatItDoes: "Filters and reshapes JSON on the command line.", howItWorks: "A small C program with its own query language.", demoFocus: "A query that picks fields out of an API response." },
  }));
  // A key is set, so only the practice setting keeps the model away.
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("WORKOS_API_KEY", "test-workos-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === `https://api.workos.com/user_management/users/${ACTOR_SUBJECT}`) {
      return new Response(JSON.stringify({ id: ACTOR_SUBJECT, email: "demian@example.com", first_name: "Demian" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const summaryRuns = (t: TestClient) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((row) => row.name.includes("generateSubmissionSummary")));

const submissionsOf = (t: TestClient, eventId: Id<"events">) =>
  t.run((ctx) => ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect());

const statuses = (t: TestClient, eventId: Id<"events">) =>
  t.run(async (ctx) => {
    const event = (await ctx.db.get(eventId))!;
    const rows = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
    return rows.map((row) => aiSummaryStatus(event, row));
  });

async function practiceHackathon(t: TestClient, practiceAiSummaries?: "sample" | "model") {
  return t.action(api.practice.createPracticeEvent, {
    expectedOrganizationId: ORG, start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 3, testJudges: 0,
    ...(practiceAiSummaries ? { practiceAiSummaries } : {}),
  });
}

test("the sample summary takes the description's sentences in order, and names the project when it runs out", () => {
  expect(buildSampleSummary({ demoTitle: "jq", description: "Filters JSON.  Reshapes it too." }).map((line) => line.text)).toEqual([
    "Filters JSON.",
    "Reshapes it too.",
    "Sample text for jq, in place of the real model.",
  ]);
});

test("a practice event defaults to sample summaries: every submission gets one, and the model is never scheduled", async () => {
  const { t } = setupTest();
  const created = await practiceHackathon(t);
  expect((await t.run((ctx) => ctx.db.get(created.eventId)))!.practiceAiSummaries).toBe("sample");
  // Test submissions, +N from the practice tools, and a phone submission through the public form.
  await t.mutation(api.practice.addPracticeSubmissions, { slug: created.slug, count: 2 });
  await t.mutation(api.events.submitHackathon, {
    slug: created.slug, participantToken: "p-phone", clientId: "client-phone-1234-abcdef", name: "Phone person", teamName: "Phone team", teamMembers: [],
    email: "demian+phone@example.com", phone: "+44 20 7946 0123", demoTitle: "From my phone", description: "Sent from a phone to try the form.",
    githubUrl: "https://github.com/jqlang/jq", videoUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", rulesAccepted: true,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await summaryRuns(t)).toHaveLength(0);
  expect(generateText).not.toHaveBeenCalled();
  const rows = await submissionsOf(t, created.eventId);
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(row.aiSummary).toMatchObject({ sample: true, model: "sample", usedReadme: false });
    expect(publicAiSummary(row)).toMatchObject({ sample: true, stale: false });
    expect(publicAiSummary(row)!.sections[0].text).toBe(row.description.split(/(?<=[.!?])\s+/)[0]);
  }
  expect(await statuses(t, created.eventId)).toEqual(Array(6).fill("ready"));
  // Each one is logged for the AI usage page, which no longer reads the submissions.
  expect(await t.run((ctx) => ctx.db.query("aiSampleSummaries").withIndex("by_event", (q) => q.eq("eventId", created.eventId)).collect())).toHaveLength(6);
});

test("switching to the real model summarises after that, is in Recent changes, and Undo goes back to samples", async () => {
  const { t } = setupTest();
  const created = await practiceHackathon(t);
  const result = await t.mutation(api.practice.setPracticeAiSummaries, { slug: created.slug, mode: "model" });
  expect(result).toEqual({ mode: "model", queued: 3 });
  expect(await summaryRuns(t)).toHaveLength(3);
  // Until the model's summaries land, judges keep the sample, marked as one.
  expect(await statuses(t, created.eventId)).toEqual(["ready", "ready", "ready"]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(generateText).toHaveBeenCalledTimes(3);
  for (const row of await submissionsOf(t, created.eventId)) {
    expect(row.aiSummary).toMatchObject({ whatItDoes: "Filters and reshapes JSON on the command line." });
    expect(row.aiSummary!.sample).toBeUndefined();
    expect(publicAiSummary(row)!.sample).toBe(false);
  }
  // New submissions go through the real path too.
  await t.mutation(api.practice.addPracticeSubmissions, { slug: created.slug, count: 1 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(generateText).toHaveBeenCalledTimes(4);

  const changes = (await t.query(api.changes.listRecentChanges, { slug: created.slug })).changes;
  const switched = changes.find((change) => change.summary === "turned on AI summaries with the real model")!;
  expect(switched).toMatchObject({ canUndo: true });
  await t.mutation(api.changes.undoChange, { slug: created.slug, changeId: switched.id });
  expect((await t.run((ctx) => ctx.db.get(created.eventId)))!.practiceAiSummaries).toBe("sample");
  for (const row of await submissionsOf(t, created.eventId)) expect(row.aiSummary).toMatchObject({ sample: true });
  expect(generateText).toHaveBeenCalledTimes(4);
});

test("a practice event made with the real model calls it, within the normal limits", async () => {
  const { t } = setupTest();
  const created = await practiceHackathon(t, "model");
  expect(await summaryRuns(t)).toHaveLength(3);
  expect((await t.run((ctx) => ctx.db.get(created.eventId)))!.aiSummaryBudget).toMatchObject({ used: 3 });
  // Switching to samples replaces them at once, without the model.
  await t.mutation(api.practice.setPracticeAiSummaries, { slug: created.slug, mode: "sample" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(generateText).not.toHaveBeenCalled();
  for (const row of await submissionsOf(t, created.eventId)) expect(row.aiSummary).toMatchObject({ sample: true });
});

test("real events ignore the setting and always use the model; the switch refuses them", async () => {
  const { t } = setupTest();
  const { eventId, slug } = await createEvent(t, { extra: { practiceAiSummaries: "sample" } });
  await addProject(t, eventId, 0);
  await t.mutation(api.judging.closeSubmissions, { slug });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await summaryRuns(t)).toHaveLength(1);
  expect(generateText).toHaveBeenCalledTimes(1);
  const [row] = await submissionsOf(t, eventId);
  expect(row.aiSummary!.sample).toBeUndefined();
  await expect(t.mutation(api.practice.setPracticeAiSummaries, { slug, mode: "model" })).rejects.toThrow("practice event");
});

test("closing a sample practice event fills any missing sample summary, with no model key", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const { t } = setupTest();
  const created = await practiceHackathon(t);
  const [first] = await submissionsOf(t, created.eventId);
  await t.run((ctx) => ctx.db.patch(first._id, { aiSummary: undefined }));
  await t.mutation(api.judging.closeSubmissions, { slug: created.slug });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await row(t, first._id))!.aiSummary).toMatchObject({ sample: true });
  expect(generateText).not.toHaveBeenCalled();
});

const row = (t: TestClient, id: Id<"submissions">) => t.run((ctx) => ctx.db.get(id));

test("sample summaries come with a sample read of the team's tracks and the event's sponsors", async () => {
  const { t } = setupTest();
  const created = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 12, testJudges: 0 });
  const reads = await t.run(async (ctx) => {
    const event = (await ctx.db.get(created.eventId))!;
    const tracks = await ctx.db.query("eventTracks").withIndex("by_event_and_order", (q) => q.eq("eventId", event._id)).collect();
    const sponsors = await ctx.db.query("eventSponsors").withIndex("by_event_and_order", (q) => q.eq("eventId", event._id)).collect();
    const rows = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect();
    return rows.map((row) => ({ picked: row.trackIds?.length ?? 0, read: publicAiRead(event, row, new Map(tracks.map((track) => [track._id, track])), sponsors) }));
  });
  expect(reads).toHaveLength(12);
  for (const { picked, read } of reads) {
    expect(read).toMatchObject({ status: "ready", overall: expect.stringContaining("Sample read") });
    expect(read!.tracks).toHaveLength(picked);
    expect(read!.tracks.every((track) => track.level !== null && track.reason?.startsWith("Sample reason"))).toBe(true);
    expect(read!.sponsors.map((sponsor) => sponsor.name)).toEqual(["OpenAI", "Vercel"]);
    expect(read!.sponsors.every((sponsor) => sponsor.level !== null)).toBe(true);
  }
  expect(generateText).not.toHaveBeenCalled();
});

test("a sponsor added to a practice event shows in every sample read at once, like on a real event", async () => {
  const { t } = setupTest();
  const created = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 4, testJudges: 0 });
  await t.mutation(api.sponsors.addSponsor, { slug: created.slug, name: "Stripe", usage: "Takes payments with Stripe." });
  const rows = await submissionsOf(t, created.eventId);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.aiSummary).toMatchObject({ sample: true, model: "sample" });
    expect(row.aiSummary!.read!.sponsors).toHaveLength(3);
    expect(row.aiSummary!.read!.overall).toContain("Sample read");
  }
  expect(generateText).not.toHaveBeenCalled();
});
