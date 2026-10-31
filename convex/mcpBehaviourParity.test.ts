import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { ACTOR_SUBJECT, ORG, addProject, createEvent, judgeKeys, judgeLink, openJudging, score, setupTest, type TestClient } from "./behaviour.testing";

const actor = `https://api.workos.com/user_management/client_test|${ACTOR_SUBJECT}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
  vi.stubEnv("WORKOS_API_KEY", "test-workos-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: ACTOR_SUBJECT, email: "demian@example.com" }), { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** An assistant connection with manage access to every organization. */
async function assistant(t: TestClient) {
  const approvalId = await t.run((ctx) => ctx.db.insert("mcpApprovals", {
    ownerAccountKey: `workos:client_test:${ACTOR_SUBJECT}`, workosUserId: ACTOR_SUBJECT, actor, source: "apiKey", name: "Test assistant",
    access: "manage", requestedScopes: ["events:manage"], approvedScopes: ["events:manage"], allOrganizations: true,
  }));
  return { organizationId: ORG, actor, mcp: { approvalId, scope: "events:manage" } };
}

test("phase, timer and undo tools do what the app does, and their changes are marked as an assistant's", async () => {
  const { t } = setupTest();
  const principal = await assistant(t);
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await openJudging(t);

  const preview = await t.query(internal.mcpAdmin.previewPhaseChange, { principal, input: { slug: "hack", phase: "submissions" } });
  expect(preview).toEqual(await t.query(api.phases.previewPhaseChange, { slug: "hack", phase: "submissions" }));
  await t.mutation(internal.mcpAdmin.setPhase, { principal, input: { slug: "hack", phase: "submissions" } });
  expect((await t.query(api.events.getAdmin, { slug: "hack" })).event).toMatchObject({ phase: "submissions", judgingPaused: true });

  const [change] = (await t.query(internal.mcpAdmin.listRecentChanges, { principal, input: { slug: "hack" } })).changes;
  expect(change).toMatchObject({ via: "assistant", isYou: true, canUndo: true });
  await t.mutation(internal.mcpAdmin.undoChange, { principal, input: { slug: "hack", changeId: change.id } });
  expect((await t.query(api.events.getAdmin, { slug: "hack" })).event).toMatchObject({ phase: "judging", judgingPaused: false });

  await t.mutation(internal.mcpAdmin.setJudgingTimeLeft, { principal, input: { slug: "hack", remainingMs: 120_000 } });
  await t.mutation(internal.mcpAdmin.pauseJudgingTimer, { principal, input: { slug: "hack" } });
  expect(await t.query(api.judging.getJudgingTimer, { slug: "hack" })).toMatchObject({ timerStatus: "paused", remainingMs: 120_000 });
  await t.mutation(internal.mcpAdmin.resumeJudgingTimer, { principal, input: { slug: "hack" } });
  expect(await t.query(api.judging.getJudgingTimer, { slug: "hack" })).toMatchObject({ timerStatus: "running", remainingMs: 120_000 });
});

test("judge tools make their own token, take string ids, and match the app's Judges table", async () => {
  const { t } = setupTest();
  const principal = await assistant(t);
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  const project = await addProject(t, eventId, 0, { trackIds: [] });
  const alex = await judgeLink(t, "Alex");
  await judgeLink(t, "Sam");
  await openJudging(t);
  await score(t, alex, project, 6);
  const keys = await judgeKeys(t);

  expect(await t.query(internal.mcpAdmin.getJudgesOverview, { principal, input: { slug: "hack" } })).toEqual(await t.query(api.judging.getJudgesOverview, { slug: "hack" }));
  const replaced = await t.mutation(internal.mcpAdmin.replaceJudgeLink, { principal, input: { slug: "hack", judgeKey: keys.alex } });
  expect(replaced.path).toMatch(/^\/judge\/hack\/[0-9a-f-]{36}$/);
  await expect(t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: alex })).rejects.toThrow("Unauthorized");

  await expect(t.mutation(internal.mcpAdmin.moveJudgeScores, { principal, input: { slug: "hack", fromJudgeKey: keys.alex, toJudgeKey: keys.taylor, submissionIds: ["not-an-id"] } })).rejects.toThrow("Submission not found");
  expect(await t.mutation(internal.mcpAdmin.moveJudgeScores, { principal, input: { slug: "hack", fromJudgeKey: keys.alex, toJudgeKey: keys.taylor, submissionIds: [project] } })).toEqual({ moved: 1 });
  await t.mutation(internal.mcpAdmin.setJudgeLinkActive, { principal, input: { slug: "hack", judgeKey: keys.sam, active: false } });
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.find((row) => row.judgeKey === keys.sam)).toMatchObject({ active: false });
});

test("practice tools work through MCP, and reset needs a matching confirmation", async () => {
  const { t } = setupTest();
  const principal = await assistant(t);
  await createEvent(t, { slug: "devday", judges: ["Alex", "Sam"] });
  const created = await t.action(internal.practice.createPracticeEventMcp, { principal, input: { expectedOrganizationId: ORG, start: { kind: "copy", slug: "devday" }, testSubmissions: 2, testJudges: 2 } });
  expect(await t.query(internal.mcpAdmin.listPracticeEvents, { principal, input: {} })).toEqual(await t.query(api.practice.listPracticeEvents, {}));
  expect(await t.query(internal.mcpAdmin.getLiveEvent, { principal, input: {} })).toMatchObject({ slug: "devday" });
  expect((await t.mutation(internal.mcpAdmin.addPracticeSubmissions, { principal, input: { slug: created.slug, count: 2 } })).submissionIds).toHaveLength(2);

  await expect(t.mutation(internal.mcpAdmin.resetPracticeEvent, { principal, input: { slug: created.slug, confirmation: { action: "reset_practice_event", slug: "devday" } } })).rejects.toThrow("Confirmation must match");
  await expect(t.mutation(internal.mcpAdmin.resetPracticeEvent, { principal, input: { slug: "devday", confirmation: { action: "reset_practice_event", slug: "devday" } } })).rejects.toThrow("only works on a practice event");
  expect(await t.mutation(internal.mcpAdmin.resetPracticeEvent, { principal, input: { slug: created.slug, keepSubmissions: false, confirmation: { action: "reset_practice_event", slug: created.slug } } })).toEqual({ phase: "submissions", keptSubmissions: 0 });
});
