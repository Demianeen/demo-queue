import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { addProject, createEvent, openJudging, setupTest } from "./behaviour.testing";

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
