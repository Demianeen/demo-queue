import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { addProject, createEvent, judgeLink, openJudging, score, setupTest } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const eventOf = (t: ReturnType<typeof setupTest>["t"], slug: string) =>
  t.run(async (ctx) => (await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", slug)).unique())!);

test("a second Next for the same presenter does nothing, so a double click never skips a pitch", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "night", eventType: "demo", extra: { queuePublished: true, phase: "stage" } });
  const first = await addProject(t, eventId, 0, { status: "queued", queueOrder: 0 });
  const second = await addProject(t, eventId, 1, { status: "queued", queueOrder: 1 });

  await t.mutation(api.events.pickNext, { slug: "night", expectedCurrentId: first });
  await t.mutation(api.events.pickNext, { slug: "night", expectedCurrentId: first });

  const statuses = await t.run(async (ctx) => [(await ctx.db.get(first))!.status, (await ctx.db.get(second))!.status]);
  expect(statuses).toEqual(["done", "queued"]);
});

test("Close judging while submissions are open again is refused", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  await addProject(t, eventId, 0);
  await openJudging(t);
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "submissions" });

  await expect(t.mutation(api.judging.closeJudging, { slug: "hack" })).rejects.toThrow("Close submissions first.");
  expect(await eventOf(t, "hack")).toMatchObject({ phase: "submissions", judgingStatus: "open" });
});

test("making a demo night's queue live moves it to Stage", async () => {
  const { t } = setupTest();
  await createEvent(t, { slug: "night", eventType: "demo", extra: { phase: "submissions" } });

  await t.mutation(api.events.publishQueue, { slug: "night" });

  expect((await t.query(api.events.getAdmin, { slug: "night" })).event.phase).toBe("stage");
});

test("No-show takes only the presenter the organiser saw", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "night", eventType: "demo", extra: { queuePublished: true, phase: "stage" } });
  const first = await addProject(t, eventId, 0, { status: "queued", queueOrder: 0 });
  const second = await addProject(t, eventId, 1, { status: "queued", queueOrder: 1 });

  await t.mutation(api.events.markNoShow, { slug: "night", expectedCurrentId: first });
  await t.mutation(api.events.markNoShow, { slug: "night", expectedCurrentId: first });

  const statuses = await t.run(async (ctx) => [(await ctx.db.get(first))!.status, (await ctx.db.get(second))!.status]);
  expect(statuses).toEqual(["no_show", "queued"]);
});

test("turning a judge off can't be undone once their projects' new judges have scored", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  for (const index of [0, 1, 2, 3, 4, 5]) await addProject(t, eventId, index);
  const tokens = new Map<string, string>();
  for (const name of ["Alex", "Sam", "Taylor"]) tokens.set(name, await judgeLink(t, name));
  await openJudging(t);

  const preview = await t.query(api.judging.previewRedistribution, { slug: "hack", unavailableJudgeKey: "taylor" });
  expect(preview.length).toBeGreaterThan(0);
  await t.mutation(api.judging.applyRedistribution, { slug: "hack", unavailableJudgeKey: "taylor", assignments: preview.map((row) => ({ submissionId: row.submissionId, judges: row.judges })) });
  const moved = preview[0];
  const newJudge = moved.judges.find((name) => name !== "Taylor")!;
  vi.advanceTimersByTime(60_000);
  await score(t, tokens.get(newJudge)!, moved.submissionId, 7);

  const [off] = (await t.query(api.changes.listRecentChanges, { slug: "hack" })).changes;
  expect(off).toMatchObject({ summary: "turned off Taylor and moved their projects", canUndo: false });
  await expect(t.mutation(api.changes.undoChange, { slug: "hack", changeId: off.id })).rejects.toThrow("scored since by its new judges");
});
