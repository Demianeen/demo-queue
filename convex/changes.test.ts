import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { addProject, createEvent, judgeLink, openJudging, score, setupTest } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const recent = async (t: ReturnType<typeof setupTest>["t"], slug = "hack") =>
  (await t.query(api.changes.listRecentChanges, { slug })).changes;

test("hiding a project shows in Recent changes with Restore, and undo brings it back", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "demo", eventType: "demo" });
  const id = await addProject(t, eventId, 0);
  await t.mutation(api.events.hideSubmission, { slug: "demo", submissionId: id });
  const [hidden] = await recent(t, "demo");
  expect(hidden).toMatchObject({ summary: "hid Project 0", undoLabel: "Restore", canUndo: true, isYou: true, via: "app", actorUserId: "user_01DEMIAN", subjectId: id });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: "hidden", normalizedEmail: "" });

  await t.mutation(api.changes.undoChange, { slug: "demo", changeId: hidden.id });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: "candidate", normalizedEmail: "person0@example.com" });
  const rows = await recent(t, "demo");
  expect(rows.map((row) => row.summary)).toEqual(['undid "hid Project 0"', "hid Project 0"]);
  expect(rows[1]).toMatchObject({ canUndo: false, undoBlockedReason: "This change was already undone.", undoneAt: expect.any(Number) });
  await expect(t.mutation(api.changes.undoChange, { slug: "demo", changeId: hidden.id })).rejects.toThrow("already undone");

  // Undoing the undo hides it again, and the first change can be undone once more.
  await t.mutation(api.changes.undoChange, { slug: "demo", changeId: rows[0].id });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: "hidden" });
  expect((await recent(t, "demo")).find((row) => row.id === hidden.id)).toMatchObject({ canUndo: true, undoneAt: null });
});

test("undo refuses when a later change touched the same fields, and names it", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "demo", eventType: "demo" });
  const id = await addProject(t, eventId, 0);
  await t.mutation(api.events.hideSubmission, { slug: "demo", submissionId: id });
  const [hidden] = await recent(t, "demo");
  await t.mutation(api.events.restoreSubmission, { slug: "demo", submissionId: id });
  await t.mutation(api.events.reorderLineup, { slug: "demo", orderedIds: [id] });
  const rows = await recent(t, "demo");
  expect(rows.find((row) => row.id === hidden.id)).toMatchObject({ canUndo: false, undoBlockedReason: 'Changed again since: undo "reordered the lineup" first.' });
  const before = await t.run((ctx) => ctx.db.get(id));
  await expect(t.mutation(api.changes.undoChange, { slug: "demo", changeId: hidden.id })).rejects.toThrow('undo "reordered the lineup" first');
  expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
});

test("undo never gives one email to two submissions", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "demo", eventType: "demo" });
  const id = await addProject(t, eventId, 0);
  await t.mutation(api.events.hideSubmission, { slug: "demo", submissionId: id });
  const [hidden] = await recent(t, "demo");
  // The same person submits again while the first one is hidden.
  await addProject(t, eventId, 1, { email: "person0@example.com", normalizedEmail: "person0@example.com" });
  await expect(t.mutation(api.changes.undoChange, { slug: "demo", changeId: hidden.id })).rejects.toThrow("Another submission now uses an email");
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: "hidden" });
});

test("closing submissions shows Reopen, and undo moves the phase back", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await t.mutation(api.judging.closeSubmissions, { slug: "hack" });
  const [closed] = await recent(t);
  expect(closed).toMatchObject({ summary: "closed submissions", undoLabel: "Reopen", canUndo: true, kind: "phase_changed" });
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: closed.id });
  expect((await t.query(api.events.getAdmin, { slug: "hack" })).event).toMatchObject({ phase: "submissions", submissionsOpen: true });
  expect((await recent(t))[0].summary).toBe('undid "closed submissions"');
});

test("a phase change cannot be undone once the event moved on", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await openJudging(t);
  const closedSubmissions = (await recent(t)).find((row) => row.summary === "closed submissions")!;
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "stage" });
  const row = (await recent(t)).find((item) => item.id === closedSubmissions.id)!;
  expect(row).toMatchObject({ canUndo: false, undoBlockedReason: expect.stringContaining("moved to Stage") });
  // The newest phase change can be undone: judging reopens.
  const [toStage] = await recent(t);
  expect(toStage).toMatchObject({ summary: "closed judging", undoLabel: "Reopen" });
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: toStage.id });
  expect((await t.query(api.judging.getJudgingTimer, { slug: "hack" }))).toMatchObject({ status: "open", timerStatus: "running" });
});

test("added time is undone exactly", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await openJudging(t);
  await t.mutation(api.judging.setJudgingTimeLeft, { slug: "hack", remainingMs: 10 * 60_000 });
  await t.mutation(api.judging.addJudgingTime, { slug: "hack", deltaMs: 5 * 60_000 });
  const [added] = await recent(t);
  expect(added.summary).toBe("added 5 minutes");
  vi.advanceTimersByTime(60_000);
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: added.id });
  expect(await t.query(api.judging.getJudgingTimer, { slug: "hack" })).toMatchObject({ timerStatus: "running", remainingMs: 9 * 60_000 });
});

test("replacing a link, moving scores and turning a judge off are all undoable", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  const projects = [];
  for (let index = 0; index < 3; index += 1) projects.push(await addProject(t, eventId, index));
  const alex = await judgeLink(t, "Alex");
  const sam = await judgeLink(t, "Sam");
  await judgeLink(t, "Taylor");
  await openJudging(t);

  // Replace Alex's link, then undo: the old link works again.
  await t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "alex", capabilityToken: "alex-new-token-123456" });
  await expect(t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: alex })).rejects.toThrow("Unauthorized");
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: (await recent(t))[0].id });
  await expect(t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: alex })).resolves.toMatchObject({ judgeName: "Alex" });

  // Sam scored on Alex's link: move them, then undo the move.
  await score(t, alex, projects[0], 6);
  await t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "alex", toJudgeKey: "sam" });
  expect(await t.run((ctx) => ctx.db.query("reviews").collect())).toMatchObject([{ judgeKey: "sam" }]);
  const [moved] = await recent(t);
  expect(moved.summary).toBe("moved 1 score from Alex to Sam");
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: moved.id });
  expect(await t.run((ctx) => ctx.db.query("reviews").collect())).toMatchObject([{ judgeKey: "alex" }]);
  void sam;

  // Turn Taylor off through the existing redistribution, then undo it.
  const before = await t.run((ctx) => ctx.db.query("submissions").collect());
  const preview = await t.query(api.judging.previewRedistribution, { slug: "hack", unavailableJudgeKey: "taylor" });
  await t.mutation(api.judging.applyRedistribution, { slug: "hack", unavailableJudgeKey: "taylor", assignments: preview.map((row) => ({ submissionId: row.submissionId, judges: row.judges })) });
  const [off] = await recent(t);
  expect(off.summary).toBe("turned off Taylor and moved their projects");
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: off.id });
  const after = await t.run((ctx) => ctx.db.query("submissions").collect());
  expect(after.map((row) => row.roundOneAssignedJudges)).toEqual(before.map((row) => row.roundOneAssignedJudges));
  expect(await t.run((ctx) => ctx.db.query("judgeAccess").withIndex("by_token", (q) => q.eq("token", "taylor-secret-token")).unique())).toMatchObject({ active: true });
});

test("clearing every submission is listed but cannot be undone", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "demo", eventType: "demo" });
  await addProject(t, eventId, 0);
  await t.mutation(api.events.clearQueue, { slug: "demo" });
  const [cleared] = await recent(t, "demo");
  expect(cleared).toMatchObject({ summary: "cleared every submission", canUndo: false, undoBlockedReason: "This change can't be undone." });
  await expect(t.mutation(api.changes.undoChange, { slug: "demo", changeId: cleared.id })).rejects.toThrow("can't be undone");
});

test("changes made by an assistant are marked, and other organizations see none of it", async () => {
  const { root, t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "demo", eventType: "demo" });
  const id = await addProject(t, eventId, 0);
  await t.mutation(api.events.hideSubmission, { slug: "demo", submissionId: id });
  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  await expect(outsider.query(api.changes.listRecentChanges, { slug: "demo" })).rejects.toThrow("Unauthorized");
  const [row] = await recent(t, "demo");
  await expect(outsider.mutation(api.changes.undoChange, { slug: "demo", changeId: row.id })).rejects.toThrow("Unauthorized");
  // Another person in the same organization sees the change as not theirs.
  const colleague = root.withIdentity({ subject: "user_03ANA", org_id: "org_live", tokenIdentifier: "https://api.workos.com/user_management/client_test|user_03ANA" });
  expect((await colleague.query(api.changes.listRecentChanges, { slug: "demo" })).changes[0]).toMatchObject({ isYou: false, actorUserId: "user_01DEMIAN" });
  await expect(colleague.mutation(api.changes.undoChange, { slug: "demo", changeId: "not-an-id" })).rejects.toThrow("Change not found.");
});
