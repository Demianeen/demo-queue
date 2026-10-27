import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import tableHistorySchema from "../node_modules/@convex-dev/table-history/src/component/schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./judging.ts": () => import("./judging"),
  "./mcpAdmin.ts": () => import("./mcpAdmin"),
};
const historyRoot = "../node_modules/@convex-dev/table-history/src/component";
const historyModules = {
  "./_generated/api.ts": () => import(/* @vite-ignore */ `${historyRoot}/_generated/api.ts`),
  "./_generated/server.ts": () => import(/* @vite-ignore */ `${historyRoot}/_generated/server.ts`),
  "./lib.ts": () => import(/* @vite-ignore */ `${historyRoot}/lib.ts`),
};
const principal = { organizationId: "org_parity", actor: "https://identity.example|operator" };
const input = { slug: "hack" };
afterEach(() => vi.useRealTimers());

async function fixture(judges = ["Alex", "Sam", "Taylor", "Jo"]) {
  const t = convexTest(schema, modules);
  t.registerComponent("judgingDecisionHistory", tableHistorySchema, historyModules);
  const browser = t.withIdentity({ subject: "operator", org_id: principal.organizationId, tokenIdentifier: principal.actor });
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "Hack", slug: "hack", eventType: "hackathon", workosOrganizationId: principal.organizationId,
    meetUrl: "https://meet.example", queuePublished: false, createdAt: 1, updatedAt: 1,
  }));
  await t.mutation(internal.mcpAdmin.saveRoundOneJudges, { principal, input: { ...input, judges } });
  return { t, browser, eventId };
}
type Test = Awaited<ReturnType<typeof fixture>>["t"];

async function submission(t: Test, eventId: Id<"events">, index: number, judges?: string[]) {
  return t.run((ctx) => ctx.db.insert("submissions", {
    eventId, participantToken: `participant-${index}`, name: `Person ${index}`, demoTitle: `Demo ${index}`,
    description: `Description ${index}`, phone: "+440000000000", status: "candidate",
    roundOneAssignedJudges: judges, createdAt: 1, updatedAt: 1,
  }));
}

async function prepare(t: Test) {
  await t.mutation(internal.mcpAdmin.closeSubmissions, { principal, input });
  await t.mutation(internal.mcpAdmin.startAssignmentPreparation, { principal, input });
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await t.mutation(internal.mcpAdmin.prepareAssignmentBatch, { principal, input });
    if (result.done) return;
  }
  throw new Error("Assignment preparation did not finish within ten batches");
}

async function link(t: Test, judgeName: string) {
  const result = await t.mutation(internal.mcpAdmin.createJudgeLink, { principal, input: { ...input, judgeName } });
  return { ...result, capabilityToken: result.path.split("/").at(-1) ?? "" };
}

async function review(t: Test, capabilityToken: string, submissionId: Id<"submissions">, score: number) {
  return t.mutation(api.judging.saveReview, {
    ...input, capabilityToken, submissionId, innovation: score, execution: score, demoClarity: score,
  });
}

test("private roster save matches browser normalization and records the trusted actor", async () => {
  const { t, browser, eventId } = await fixture();
  expect(await t.mutation(internal.mcpAdmin.saveRoundOneJudges, {
    principal, input: { ...input, judges: ["  Alex  ", "Sam"] },
  })).toEqual({ judgeCount: 2, reassignedSubmissionCount: 0 });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ roundOneJudges: ["Alex", "Sam"] });
  expect(await browser.mutation(api.events.saveRoundOneJudges, {
    ...input, judges: ["Alex", " Sam "],
  })).toEqual({ judgeCount: 2, reassignedSubmissionCount: 0 });
  const log = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect());
  expect(log.map(({ action, actor, details }) => ({ action, actor, details }))).toEqual([
    { action: "round_one_judges_saved", actor: principal.actor, details: "4" },
    { action: "round_one_judges_saved", actor: principal.actor, details: "2" },
    { action: "round_one_judges_saved", actor: principal.actor, details: "2" },
  ]);
});

test("private judge links are generated, rotated, listed and absent from public event reads", async () => {
  const { t, browser } = await fixture();
  const first = await link(t, "Alex");
  expect(first).toMatchObject({ judgeKey: "alex", path: expect.stringMatching(/^\/judge\/hack\/[a-f0-9-]{36}$/) });
  expect(await t.query(api.judging.getMyAssignments, { ...input, capabilityToken: first.capabilityToken })).toMatchObject({ judgeName: "Alex", judgingStatus: "setup" });
  const rotated = await link(t, "Alex");
  expect(rotated.path).not.toBe(first.path);
  await expect(t.query(api.judging.getMyAssignments, { ...input, capabilityToken: first.capabilityToken })).rejects.toThrow("Unauthorized");
  expect(await t.query(internal.mcpAdmin.listJudgeLinks, { principal, input })).toEqual([
    { judgeKey: "alex", judgeName: "Alex", active: true, path: rotated.path, createdAt: expect.any(Number), updatedAt: expect.any(Number) },
  ]);
  expect(await browser.query(api.judging.listJudgeAccess, input)).toMatchObject([{ judgeKey: "alex", token: rotated.capabilityToken, active: true }]);
  const publicEvent = await t.query(api.events.getEventMeta, input);
  expect(publicEvent).toEqual({ name: "Hack", slug: "hack", eventType: "hackathon" });
  expect(JSON.stringify(await t.query(api.events.getStage, input))).not.toContain(rotated.capabilityToken);
  await expect(t.query(api.judging.listJudgeAccess, input)).rejects.toThrow("Sign in");
  await expect(t.mutation(api.judging.createJudgeAccess, { ...input, judgeName: "Alex", capabilityToken: "chosen-by-public-client" })).rejects.toThrow("Sign in");
  await expect(t.mutation(internal.mcpAdmin.createJudgeLink, { principal, input: { ...input, judgeName: "Unknown" } })).rejects.toThrow("Add this judge");
  await t.mutation(internal.mcpAdmin.saveRoundOneJudges, { principal, input: { ...input, judges: ["Sam", "Taylor"] } });
  expect(await t.query(internal.mcpAdmin.listJudgeLinks, { principal, input })).toMatchObject([{ judgeKey: "alex", active: false, path: rotated.path }]);
});

test("private assignment preparation resumes across 50-row batches and hides partial rounds", async () => {
  const { t, browser, eventId } = await fixture(["Alex", "Sam"]);
  for (let index = 0; index < 51; index += 1) await submission(t, eventId, index);
  const alex = await link(t, "Alex");
  expect(await t.mutation(internal.mcpAdmin.closeSubmissions, { principal, input })).toEqual({ judgingStatus: "setup" });
  expect(await browser.mutation(api.judging.closeSubmissions, input)).toEqual({ judgingStatus: "setup" });
  expect(await t.mutation(internal.mcpAdmin.startAssignmentPreparation, { principal, input })).toEqual({ status: "preparing_assignments" });
  expect(await t.mutation(internal.mcpAdmin.prepareAssignmentBatch, { principal, input })).toEqual({ processed: 50, done: false });
  expect(await t.query(api.judging.getMyAssignments, { ...input, capabilityToken: alex.capabilityToken })).toMatchObject({ judgingStatus: "preparing_assignments", assignments: [] });
  await expect(t.mutation(internal.mcpAdmin.startJudging, { principal, input })).rejects.toThrow("Assignments are not ready");
  expect(await t.mutation(internal.mcpAdmin.prepareAssignmentBatch, { principal, input })).toEqual({ processed: 1, done: true });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ judgingStatus: "ready", assignmentPreparationTotal: 51, assignmentVersion: 1 });
  const progress = await t.query(internal.mcpAdmin.getAdminProgress, { principal, input });
  expect(progress).toMatchObject({ eventStatus: "ready", totalSubmissions: 51, assignmentVersion: 1 });
  expect(progress.scoring.map((row) => [...row.assignedJudges].sort())).toEqual(Array.from({ length: 51 }, () => ["Alex", "Sam"]));
  expect(await browser.query(api.judging.getAdminProgress, input)).toEqual(progress);
});

test("private judging timer matches browser reads through start, adjustment, close and reopen", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  const { t, browser, eventId } = await fixture();
  await submission(t, eventId, 1);
  await prepare(t);
  await t.mutation(internal.mcpAdmin.setJudgingTimer, { principal, input: { ...input, durationMs: -10 } });
  expect(await t.query(internal.mcpAdmin.getJudgingTimer, { principal, input })).toEqual({ status: "ready", timerStatus: "idle", remainingMs: 3_600_000, serverNow: Date.now() });
  await t.mutation(internal.mcpAdmin.setJudgingTimer, { principal, input: { ...input, durationMs: 60_000.4 } });
  await t.mutation(internal.mcpAdmin.startJudging, { principal, input });
  vi.setSystemTime(Date.now() + 10_000);
  await t.mutation(internal.mcpAdmin.addJudgingTime, { principal, input: { ...input, deltaMs: 15_000 } });
  expect(await t.query(internal.mcpAdmin.getJudgingTimer, { principal, input })).toEqual({ status: "open", timerStatus: "running", remainingMs: 65_000, serverNow: Date.now() });
  expect(await browser.query(api.judging.getJudgingTimer, input)).toEqual(await t.query(internal.mcpAdmin.getJudgingTimer, { principal, input }));
  await t.mutation(internal.mcpAdmin.closeJudging, { principal, input });
  vi.setSystemTime(Date.now() + 20_000);
  expect(await t.query(internal.mcpAdmin.getJudgingTimer, { principal, input })).toMatchObject({ status: "closed", timerStatus: "idle", remainingMs: 65_000 });
  await t.mutation(internal.mcpAdmin.reopenJudging, { principal, input });
  expect(await t.query(internal.mcpAdmin.getJudgingTimer, { principal, input })).toMatchObject({ status: "open", timerStatus: "running", remainingMs: 65_000 });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ judgingStatus: "open", judgingTimerEndsAt: Date.now() + 65_000 });
});

test("private normalization uses real judge reviews, persists decisions and preserves finalist history", async () => {
  const { t, browser, eventId } = await fixture(["Alex", "Sam"]);
  const first = await submission(t, eventId, 1);
  const second = await submission(t, eventId, 2);
  const alex = await link(t, "Alex");
  const sam = await link(t, "Sam");
  await prepare(t);
  await t.mutation(internal.mcpAdmin.startJudging, { principal, input });
  for (const item of [
    { token: alex.capabilityToken, id: first, score: 9 }, { token: sam.capabilityToken, id: first, score: 1 },
    { token: alex.capabilityToken, id: second, score: 3 }, { token: sam.capabilityToken, id: second, score: 9 },
  ]) expect(await review(t, item.token, item.id, item.score)).toEqual({ completed: true });
  await expect(t.mutation(internal.mcpAdmin.saveNormalizationDecision, { principal, input: { ...input, judgeKey: "alex", decision: "raw" } })).rejects.toThrow("Close judging first");
  await t.mutation(internal.mcpAdmin.closeJudging, { principal, input });
  const progress = await t.query(internal.mcpAdmin.getAdminProgress, { principal, input });
  expect(progress.scoring).toMatchObject([{ submissionId: first, score: 5, completeReviewCount: 2 }, { submissionId: second, score: 6, completeReviewCount: 2 }]);
  expect(progress.reviews).toHaveLength(4);
  expect(await browser.query(api.judging.getAdminProgress, input)).toEqual(progress);
  const overview = await t.query(internal.mcpAdmin.getNormalizationOverview, { principal, input });
  expect(await browser.query(api.judging.getNormalizationOverview, input)).toEqual(overview);
  expect(overview).toMatchObject({ judgingStatus: "closed", scoreBasisReady: true, scoreBasisVersion: 4, judges: [
    { judgeKey: "alex", completeReviewCount: 2, lowData: true, delta: { innovation: -0.5, execution: -0.5, demoClarity: -0.5 }, effectiveDecision: "apply", reviews: [{ rawAverage: 9, adjustedAverage: 8.5 }, { rawAverage: 3, adjustedAverage: 2.5 }] },
    { judgeKey: "sam", completeReviewCount: 2, delta: { innovation: 0.5, execution: 0.5, demoClarity: 0.5 } },
  ] });
  expect(await t.mutation(internal.mcpAdmin.saveNormalizationDecision, { principal, input: { ...input, judgeKey: "sam", decision: "raw" } })).toEqual({ scoreBasisReady: true });
  await browser.mutation(api.judging.saveNormalizationDecision, { ...input, judgeKey: "alex", decision: "apply" });
  expect(await t.run((ctx) => ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect())).toMatchObject([
    { judgeKey: "sam", decision: "raw", stale: false, scoreBasisVersion: 4 }, { judgeKey: "alex", decision: "apply", stale: false, scoreBasisVersion: 4 },
  ]);
  expect(await browser.query(api.judging.getFinalistDecision, input)).toMatchObject({ submissions: [
    { submissionId: second, rawScore: 6, score: 5.75, adjustedReviewCount: 1 },
    { submissionId: first, rawScore: 5, score: 4.75, adjustedReviewCount: 1 },
  ] });
  await browser.mutation(api.judging.submitFinalists, { ...input, finalistIds: [second] });
  const historyArgs = { maxTs: Date.now() + 10_000, paginationOpts: { numItems: 10, cursor: null } };
  const beforeHistory = await t.query(components.judgingDecisionHistory.lib.listHistory, historyArgs);
  expect(beforeHistory.page).toMatchObject([{ doc: { eventId, finalistIds: [second], finalistStatus: "submitted", finalistVersion: 1 } }]);
  await expect(review(t, sam.capabilityToken, first, 2)).rejects.toThrow("Judging is not open");
  await t.mutation(internal.mcpAdmin.reopenJudging, { principal, input });
  await review(t, sam.capabilityToken, first, 2);
  await t.mutation(internal.mcpAdmin.closeJudging, { principal, input });
  expect(await t.query(internal.mcpAdmin.getNormalizationOverview, { principal, input })).toMatchObject({ scoreBasisVersion: 5, judges: [
    { judgeKey: "alex", decision: { decision: "apply", stale: false } },
    { judgeKey: "sam", decision: { decision: "raw", stale: true }, effectiveDecision: "apply" },
  ] });
  await t.mutation(internal.mcpAdmin.saveNormalizationDecision, { principal, input: { ...input, judgeKey: "sam", decision: "raw" } });
  expect(await t.query(internal.mcpAdmin.getNormalizationOverview, { principal, input })).toMatchObject({ judges: [
    { judgeKey: "alex", effectiveDecision: "apply" }, { judgeKey: "sam", decision: { decision: "raw", stale: false }, effectiveDecision: "raw" },
  ] });
  expect((await t.query(components.judgingDecisionHistory.lib.listHistory, historyArgs)).page).toEqual(beforeHistory.page);
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ confirmedScoreBasisVersion: 5 });
  await expect(t.mutation(internal.mcpAdmin.saveNormalizationDecision, { principal, input: { ...input, judgeKey: "missing", decision: "apply" } })).rejects.toThrow("no complete reviews");
});

test("private redistribution rejects incomplete, duplicate, foreign and changed previews, preserving completed reviews", async () => {
  const { t, browser, eventId } = await fixture();
  const first = await submission(t, eventId, 1, ["Alex", "Sam"]);
  const second = await submission(t, eventId, 2, ["Alex", "Sam"]);
  const finished = await submission(t, eventId, 3, ["Alex", "Sam"]);
  const foreignEvent = await t.run((ctx) => ctx.db.insert("events", { name: "Foreign", slug: "foreign", eventType: "hackathon", workosOrganizationId: "org_other", meetUrl: "https://meet.example", queuePublished: false, createdAt: 1, updatedAt: 1 }));
  const foreign = await submission(t, foreignEvent, 4, ["Alex", "Sam"]);
  const alex = await link(t, "Alex");
  const sam = await link(t, "Sam");
  await prepare(t);
  await t.mutation(internal.mcpAdmin.startJudging, { principal, input });
  await review(t, sam.capabilityToken, first, 8);
  await review(t, alex.capabilityToken, finished, 7);
  const previewInput = { ...input, unavailableJudgeKey: "alex" };
  const preview = await t.query(internal.mcpAdmin.previewRedistribution, { principal, input: previewInput });
  expect(preview).toMatchObject([
    { submissionId: first, previousJudges: ["Alex", "Sam"], judges: ["Taylor", "Sam"], preservedCompletedJudge: "sam" },
    { submissionId: second, previousJudges: ["Alex", "Sam"], judges: ["Jo", "Sam"], preservedCompletedJudge: null },
  ]);
  expect(await browser.query(api.judging.previewRedistribution, previewInput)).toEqual(preview);
  const assignments = preview.map(({ submissionId, judges }) => ({ submissionId, judges }));
  const apply = (items: typeof assignments) => t.mutation(internal.mcpAdmin.applyRedistribution, { principal, input: { ...previewInput, assignments: items } });
  await expect(apply(assignments.slice(0, 1))).rejects.toThrow("every unfinished assignment");
  await expect(apply([...assignments, ...assignments])).rejects.toThrow("every unfinished assignment");
  await expect(apply([{ submissionId: foreign, judges: ["Taylor", "Sam"] }, assignments[1]])).rejects.toThrow("every unfinished assignment");
  await expect(apply(assignments.map((item) => ({ ...item, judges: ["Taylor", "Jo"] })))).rejects.toThrow("keep the other assigned judge");
  await expect(apply(assignments.map((item) => ({ ...item, judges: ["Alex", "Sam"] })))).rejects.toThrow("Invalid judge assignment");
  await review(t, alex.capabilityToken, second, 6);
  await expect(apply(assignments)).rejects.toThrow("every unfinished assignment");
  const fresh = await t.query(internal.mcpAdmin.previewRedistribution, { principal, input: previewInput });
  expect(fresh).toMatchObject([{ submissionId: first, preservedCompletedJudge: "sam" }]);
  expect(fresh).toHaveLength(1);
  await apply(fresh.map(({ submissionId, judges }) => ({ submissionId, judges })));
  expect(await t.run((ctx) => ctx.db.get(first))).toMatchObject({ roundOneAssignedJudges: ["Taylor", "Sam"] });
  expect(await t.run((ctx) => ctx.db.get(second))).toMatchObject({ roundOneAssignedJudges: ["Alex", "Sam"] });
  expect(await t.run((ctx) => ctx.db.get(finished))).toMatchObject({ roundOneAssignedJudges: ["Alex", "Sam"] });
  expect(await t.query(internal.mcpAdmin.getAdminProgress, { principal, input })).toMatchObject({ scoring: [
    { submissionId: first, score: 8, completeReviewCount: 1 }, { submissionId: second, score: 6, completeReviewCount: 1 }, { submissionId: finished, score: 7, completeReviewCount: 1 },
  ] });
  expect(await t.query(internal.mcpAdmin.listJudgeLinks, { principal, input })).toMatchObject([{ judgeKey: "alex", active: false }, { judgeKey: "sam", active: true }]);
  await expect(review(t, alex.capabilityToken, first, 10)).rejects.toThrow("Unauthorized");
  await expect(t.query(api.judging.getMyAssignments, { ...input, capabilityToken: alex.capabilityToken })).rejects.toThrow("Unauthorized");
});

test("private judging operations reject foreign organizations and non-hackathon events", async () => {
  const { t } = await fixture();
  const foreign = { ...principal, organizationId: "org_foreign" };
  await t.run((ctx) => ctx.db.insert("events", { name: "Demo", slug: "demo", eventType: "demo", workosOrganizationId: principal.organizationId, meetUrl: "https://meet.example", queuePublished: false, createdAt: 1, updatedAt: 1 }));
  for (const deniedInput of [input, { slug: "demo" }]) {
    const selectedPrincipal = deniedInput.slug === "hack" ? foreign : principal;
    const args = { principal: selectedPrincipal, input: deniedInput };
    const message = deniedInput.slug === "hack" ? "Unauthorized" : "only available for hackathon events";
    const calls = [
      () => t.query(internal.mcpAdmin.listJudgeLinks, args),
      () => t.mutation(internal.mcpAdmin.createJudgeLink, { ...args, input: { ...deniedInput, judgeName: "Alex" } }),
      () => t.mutation(internal.mcpAdmin.closeSubmissions, args),
      () => t.mutation(internal.mcpAdmin.startAssignmentPreparation, args),
      () => t.mutation(internal.mcpAdmin.prepareAssignmentBatch, args),
      () => t.query(internal.mcpAdmin.previewRedistribution, { ...args, input: { ...deniedInput, unavailableJudgeKey: "alex" } }),
      () => t.mutation(internal.mcpAdmin.applyRedistribution, { ...args, input: { ...deniedInput, unavailableJudgeKey: "alex", assignments: [] } }),
      () => t.query(internal.mcpAdmin.getAdminProgress, args),
      () => t.mutation(internal.mcpAdmin.setJudgingTimer, { ...args, input: { ...deniedInput, durationMs: 60_000 } }),
      () => t.mutation(internal.mcpAdmin.startJudging, args),
      () => t.mutation(internal.mcpAdmin.addJudgingTime, { ...args, input: { ...deniedInput, deltaMs: 1_000 } }),
      () => t.mutation(internal.mcpAdmin.closeJudging, args),
      () => t.mutation(internal.mcpAdmin.reopenJudging, args),
      () => t.query(internal.mcpAdmin.getJudgingTimer, args),
      () => t.query(internal.mcpAdmin.getNormalizationOverview, args),
      () => t.mutation(internal.mcpAdmin.saveNormalizationDecision, { ...args, input: { ...deniedInput, judgeKey: "alex", decision: "raw" } }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(message);
  }
  expect(await t.query(internal.mcpAdmin.getJudgingTimer, { principal, input })).toMatchObject({ status: "setup", timerStatus: "idle", remainingMs: 3_600_000 });
});

test("private judging rejects invalid lifecycle transitions and judge tokens cannot administer events", async () => {
  const { t, browser, eventId } = await fixture();
  const first = await submission(t, eventId, 1);
  const alex = await link(t, "Alex");
  await expect(t.mutation(internal.mcpAdmin.startAssignmentPreparation, { principal, input })).rejects.toThrow("Close submissions first");
  await expect(t.mutation(internal.mcpAdmin.prepareAssignmentBatch, { principal, input })).rejects.toThrow("preparation is not active");
  await expect(t.mutation(internal.mcpAdmin.closeJudging, { principal, input })).rejects.toThrow("Judging is not open");
  await expect(t.mutation(internal.mcpAdmin.reopenJudging, { principal, input })).rejects.toThrow("Judging is not closed");
  await expect(t.mutation(api.judging.startJudging, input)).rejects.toThrow("Sign in");
  await expect(t.mutation(api.judging.closeSubmissions, input)).rejects.toThrow("Sign in");
  await expect(t.query(api.judging.getMyAssignments, { ...input, capabilityToken: "participant-1" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.events.getParticipant, { ...input, participantToken: alex.capabilityToken })).rejects.toThrow();
  expect(await browser.query(api.judging.getAdminProgress, input)).toMatchObject({ eventStatus: "setup", totalSubmissions: 1 });
  await prepare(t);
  await t.mutation(internal.mcpAdmin.startJudging, { principal, input });
  await expect(t.mutation(internal.mcpAdmin.startAssignmentPreparation, { principal, input })).rejects.toThrow("before judging starts");
  const foreignEventId = await t.run((ctx) => ctx.db.insert("events", { name: "Other", slug: "other", eventType: "hackathon", workosOrganizationId: "org_foreign", meetUrl: "https://meet.example", queuePublished: false, createdAt: 1, updatedAt: 1 }));
  const foreignSubmissionId = await submission(t, foreignEventId, 99, ["Alex", "Sam"]);
  await expect(review(t, alex.capabilityToken, foreignSubmissionId, 10)).rejects.toThrow("not assigned to this judge");
  expect(await review(t, alex.capabilityToken, first, 8)).toEqual({ completed: true });
});
