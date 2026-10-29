import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { addProject, createEvent, judgeLink, openJudging, score, setupTest } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const eventOf = (t: ReturnType<typeof setupTest>["t"], slug = "hack") =>
  t.run(async (ctx) => (await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", slug)).unique())!);

test("older events derive their phase from the state they already have", async () => {
  const { t } = setupTest();
  await createEvent(t, { slug: "open" });
  await createEvent(t, { slug: "judging", extra: { submissionsClosedAt: 1, judgingStatus: "open" } });
  await createEvent(t, { slug: "results", extra: { submissionsClosedAt: 1, judgingStatus: "closed" } });
  await createEvent(t, { slug: "demo-live", eventType: "demo", extra: { queuePublished: true } });
  const phase = async (slug: string) => (await t.query(api.events.getAdmin, { slug })).event.phase;
  expect(await phase("open")).toBe("submissions");
  expect(await phase("judging")).toBe("judging");
  expect(await phase("results")).toBe("stage");
  expect(await phase("demo-live")).toBe("stage");
  expect((await t.query(api.events.getAdmin, { slug: "demo-live" })).event.phases).toEqual(["submissions", "stage", "finished"]);
});

test("judging back to submissions pauses the timer, keeps every score, and comes straight back", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  const first = await addProject(t, eventId, 0);
  const alex = await judgeLink(t, "Alex");
  await openJudging(t);
  await t.mutation(api.judging.setJudgingTimeLeft, { slug: "hack", remainingMs: 20 * 60_000 });
  await score(t, alex, first, 7);
  vi.advanceTimersByTime(60_000);

  const preview = await t.query(api.phases.previewPhaseChange, { slug: "hack", phase: "submissions" });
  expect(preview).toMatchObject({ from: "judging", to: "submissions", direction: "back", judgingRemainingMs: 19 * 60_000 });
  expect(preview.effects.map((effect) => effect.code)).toEqual(["submissions_reopen", "judging_timer_pause", "scores_kept"]);

  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "submissions" });
  let event = await eventOf(t);
  expect(event).toMatchObject({ phase: "submissions", judgingStatus: "open", judgingTimerStatus: "paused", judgingTimerRemainingMs: 19 * 60_000, judgingTimerPausedByPhase: true });
  expect(event.submissionsClosedAt).toBeUndefined();
  // Judges can read but not save while submissions are open again.
  await expect(score(t, alex, first, 9)).rejects.toThrow("Judging is paused");
  const workspace = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: alex });
  expect(workspace).toMatchObject({ judgingPaused: true, canScore: false });
  expect((await t.query(api.events.getAdmin, { slug: "hack" })).event).toMatchObject({ phase: "submissions", submissionsOpen: true, judgingPaused: true });

  // A late team submits, then judging resumes where it paused and the newcomer gets two judges.
  const late = await addProject(t, eventId, 1);
  vi.advanceTimersByTime(5 * 60_000);
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "judging" });
  event = await eventOf(t);
  expect(event).toMatchObject({ phase: "judging", judgingStatus: "open", judgingTimerStatus: "running" });
  expect(event.judgingTimerEndsAt! - Date.now()).toBe(19 * 60_000);
  expect((await t.run((ctx) => ctx.db.get(late)))!.roundOneAssignedJudges).toHaveLength(2);
  expect(await t.run((ctx) => ctx.db.query("reviews").collect())).toMatchObject([{ submissionId: first, innovation: 7, completed: true }]);
  await expect(score(t, alex, first, 9)).resolves.toEqual({ completed: true });
});

test("any phase in either direction, one step at a time", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await openJudging(t);

  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "finished" });
  let event = await eventOf(t);
  expect(event).toMatchObject({ phase: "finished", judgingStatus: "closed", finishedAt: Date.now() });

  // Straight back to judging: reopened, timer running again.
  const preview = await t.query(api.phases.previewPhaseChange, { slug: "hack", phase: "judging" });
  expect(preview.effects.map((effect) => effect.code)).toEqual(["unfinish", "judging_reopen", "scores_kept"]);
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "judging" });
  event = await eventOf(t);
  expect(event).toMatchObject({ phase: "judging", judgingStatus: "open", judgingTimerStatus: "running" });
  expect(event.finishedAt).toBeUndefined();

  // Moving to the phase it is in changes nothing.
  expect(await t.mutation(api.phases.setPhase, { slug: "hack", phase: "judging" })).toEqual({ phase: "judging", effects: [] });
});

test("skipping judging that never started leaves it as it was", async () => {
  const { t } = setupTest();
  await createEvent(t);
  const preview = await t.query(api.phases.previewPhaseChange, { slug: "hack", phase: "stage" });
  expect(preview.effects.map((effect) => effect.code)).toEqual(["submissions_close", "ai_summaries_queue", "judging_skipped"]);
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "stage" });
  expect(await eventOf(t)).toMatchObject({ phase: "stage", judgingStatus: "setup", submissionsClosedAt: expect.any(Number) });
  // And back again, all the way to submissions.
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "submissions" });
  expect((await eventOf(t)).submissionsClosedAt).toBeUndefined();
});

test("a demo night has no judging phase, and its stage publishes the lineup", async () => {
  const { t } = setupTest();
  await createEvent(t, { slug: "demo", eventType: "demo" });
  await expect(t.mutation(api.phases.setPhase, { slug: "demo", phase: "judging" })).rejects.toThrow("A demo night has no judging phase.");
  await t.mutation(api.phases.setPhase, { slug: "demo", phase: "stage" });
  expect(await eventOf(t, "demo")).toMatchObject({ phase: "stage", queuePublished: true, stageScreenMode: "demo" });
  await expect(t.mutation(api.phases.reopenSubmissions, { slug: "demo" })).rejects.toThrow("always open");
});

test("reopen submissions on its own, and close them again keeps judging set up", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await t.mutation(api.judging.closeSubmissions, { slug: "hack" });
  await t.mutation(api.judging.startAssignmentPreparation, { slug: "hack" });
  while (!(await t.mutation(api.judging.prepareAssignmentBatch, { slug: "hack" })).done);
  await t.mutation(api.phases.reopenSubmissions, { slug: "hack" });
  await expect(t.mutation(api.judging.startJudging, { slug: "hack" })).rejects.toThrow("Close submissions first.");
  await t.mutation(api.judging.closeSubmissions, { slug: "hack" });
  expect(await eventOf(t)).toMatchObject({ judgingStatus: "ready", phase: "judging" });
});

test("assigning judges in progress blocks moving past judging", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await t.mutation(api.judging.closeSubmissions, { slug: "hack" });
  await t.mutation(api.judging.startAssignmentPreparation, { slug: "hack" });
  await expect(t.mutation(api.phases.setPhase, { slug: "hack", phase: "stage" })).rejects.toThrow("Judges are being assigned");
});

test("the judging timer takes an exact time, pauses and resumes", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await openJudging(t);
  await t.mutation(api.judging.setJudgingTimeLeft, { slug: "hack", remainingMs: 15 * 60_000 + 400 });
  let timer = await t.query(api.judging.getJudgingTimer, { slug: "hack" });
  expect(timer).toMatchObject({ timerStatus: "running", remainingMs: 15 * 60_000 });

  vi.advanceTimersByTime(30_000);
  await t.mutation(api.judging.pauseJudgingTimer, { slug: "hack" });
  vi.advanceTimersByTime(10 * 60_000);
  timer = await t.query(api.judging.getJudgingTimer, { slug: "hack" });
  expect(timer).toMatchObject({ timerStatus: "paused", remainingMs: 14.5 * 60_000 });

  // Typing a time while paused keeps it paused.
  await t.mutation(api.judging.setJudgingTimeLeft, { slug: "hack", remainingMs: 5 * 60_000 });
  expect(await t.query(api.judging.getJudgingTimer, { slug: "hack" })).toMatchObject({ timerStatus: "paused", remainingMs: 5 * 60_000 });
  await t.mutation(api.judging.resumeJudgingTimer, { slug: "hack" });
  vi.advanceTimersByTime(60_000);
  expect(await t.query(api.judging.getJudgingTimer, { slug: "hack" })).toMatchObject({ timerStatus: "running", remainingMs: 4 * 60_000 });
  await expect(t.mutation(api.judging.setJudgingTimeLeft, { slug: "hack", remainingMs: Number.NaN })).rejects.toThrow("Enter a time.");

  // setJudgingTimer on a running timer now moves the end too.
  await t.mutation(api.judging.setJudgingTimer, { slug: "hack", durationMs: 30 * 60_000 });
  expect(await t.query(api.judging.getJudgingTimer, { slug: "hack" })).toMatchObject({ remainingMs: 30 * 60_000 });
});

test("the stage timer takes an exact time", async () => {
  const { t } = setupTest();
  await createEvent(t, { slug: "demo", eventType: "demo" });
  await t.mutation(api.events.setStageTimerRemaining, { slug: "demo", remainingMs: 10 * 60_000 });
  expect((await t.query(api.events.getAdmin, { slug: "demo" })).event.stageTimer).toMatchObject({ status: "idle", remainingMs: 10 * 60_000, durationMs: 10 * 60_000 });
  await t.mutation(api.events.startStageTimer, { slug: "demo" });
  vi.advanceTimersByTime(60_000);
  await t.mutation(api.events.setStageTimerRemaining, { slug: "demo", remainingMs: 30_000 });
  vi.advanceTimersByTime(10_000);
  expect((await t.query(api.events.getAdmin, { slug: "demo" })).event.stageTimer).toMatchObject({ status: "running", remainingMs: 20_000 });
});

test("other organizations cannot move an event's phase", async () => {
  const { root, t } = setupTest();
  await createEvent(t);
  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  await expect(outsider.mutation(api.phases.setPhase, { slug: "hack", phase: "judging" })).rejects.toThrow("Unauthorized");
  await expect(outsider.query(api.phases.previewPhaseChange, { slug: "hack", phase: "judging" })).rejects.toThrow("Unauthorized");
});

test("a project that arrives after reopening is never given a judge whose link is off", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  await addProject(t, eventId, 0);
  for (const judge of ["Alex", "Sam", "Taylor"]) await judgeLink(t, judge);
  await openJudging(t);
  await t.mutation(api.judging.deactivateJudgeAccess, { slug: "hack", judgeKey: "taylor", active: false });
  await t.mutation(api.phases.reopenSubmissions, { slug: "hack" });
  const late = await addProject(t, eventId, 1);
  await t.mutation(api.judging.closeSubmissions, { slug: "hack" });
  const assigned = await t.run(async (ctx) => (await ctx.db.get(late))!.roundOneAssignedJudges);
  expect(assigned?.slice().sort()).toEqual(["Alex", "Sam"]);
});

test("saving the judges keeps a link that was turned off deliberately, and turns on a new judge's", async () => {
  const { t } = setupTest();
  await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  for (const judge of ["Alex", "Sam", "Taylor"]) await judgeLink(t, judge);
  await t.mutation(api.judging.deactivateJudgeAccess, { slug: "hack", judgeKey: "taylor", active: false });
  // Removed and added back: the link comes back on.
  await t.mutation(api.events.saveRoundOneJudges, { slug: "hack", judges: ["Alex", "Taylor"] });
  await t.mutation(api.events.saveRoundOneJudges, { slug: "hack", judges: ["Alex", "Sam", "Taylor"] });
  const links = await t.run((ctx) => ctx.db.query("judgeAccess").collect());
  expect(Object.fromEntries(links.map((link) => [link.judgeKey, link.active]))).toEqual({ alex: true, sam: true, taylor: false });
  // The roster save is one change that undo can reverse, links included.
  const [saved] = (await t.query(api.changes.listRecentChanges, { slug: "hack" })).changes;
  expect(saved).toMatchObject({ summary: "updated the judges", canUndo: true });
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: saved.id });
  const after = await t.run((ctx) => ctx.db.query("judgeAccess").collect());
  expect(Object.fromEntries(after.map((link) => [link.judgeKey, link.active]))).toEqual({ alex: true, sam: false, taylor: false });
});
