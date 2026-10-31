import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACTOR_SUBJECT, ORG, addProject, createEvent, setupTest, type TestClient } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T21:00:00Z"));
});
afterEach(() => vi.useRealTimers());

/**
 * A hackathon on Stage with judging closed: six projects, five finalists in
 * pitch order (4, 2, 0, 1, 3) and the winners 2, 0, 1 submitted.
 */
async function finalNight(t: TestClient, decision: { placementIds?: number[]; placementStatus?: "draft" | "submitted" } = {}) {
  const { eventId } = await createEvent(t, { extra: { submissionsClosedAt: 1, judgingStatus: "closed", phase: "stage", queuePublished: true } });
  const ids: Id<"submissions">[] = [];
  for (let index = 0; index < 6; index += 1) ids.push(await addProject(t, eventId, index, index === 1 ? { teamName: "Team Spike" } : {}));
  const finalistIds = [4, 2, 0, 1, 3].map((index) => ids[index]);
  await t.run(async (ctx) => {
    for (const id of finalistIds) await ctx.db.patch(id, { finalist: true, status: "done" });
    await ctx.db.insert("judgingDecisions", {
      eventId, finalistIds, placementIds: (decision.placementIds ?? [2, 0, 1]).map((index) => ids[index]),
      finalistVersion: 1, placementVersion: 1, finalistStatus: "submitted", placementStatus: decision.placementStatus ?? "submitted", updatedAt: Date.now(),
    });
  });
  return { eventId, ids };
}

const finish = (t: TestClient) => t.mutation(api.phases.setPhase, { slug: "hack", phase: "finished" });
const placement = async (t: TestClient, index: number) =>
  (await t.query(api.events.getParticipant, { slug: "hack", participantToken: `participant-${index}` })).submission.placement;

test("the stage and the status pages show the winners only once the event is finished", async () => {
  const { t } = setupTest();
  await finalNight(t);
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toBeNull();
  expect(await placement(t, 2)).toBeNull();

  await finish(t);
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toEqual({
    winners: [
      { place: 1, demoTitle: "Project 2", teamName: "Person 2" },
      { place: 2, demoTitle: "Project 0", teamName: "Person 0" },
      { place: 3, demoTitle: "Project 1", teamName: "Team Spike" },
    ],
    // The finalists who were not placed, in their pitch order.
    finalists: [
      { demoTitle: "Project 4", teamName: "Person 4" },
      { demoTitle: "Project 3", teamName: "Person 3" },
    ],
    showFinalists: true,
  });
  expect(await placement(t, 2)).toBe(1);
  expect(await placement(t, 0)).toBe(2);
  expect(await placement(t, 1)).toBe(3);
  expect(await placement(t, 4)).toBeNull();
  expect(await placement(t, 5)).toBeNull();

  // Back to Stage hides them again.
  await t.mutation(api.phases.setPhase, { slug: "hack", phase: "stage" });
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toBeNull();
  expect(await placement(t, 2)).toBeNull();
});

test("nothing is revealed while the winners are a draft or no longer hold", async () => {
  const { t } = setupTest();
  const { eventId, ids } = await finalNight(t, { placementStatus: "draft" });
  await finish(t);
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toBeNull();
  expect(await placement(t, 2)).toBeNull();

  // Submitted, but a winner is no longer a finalist.
  await t.run(async (ctx) => {
    const decision = (await ctx.db.query("judgingDecisions").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique())!;
    await ctx.db.patch(decision._id, { placementStatus: "submitted", placementIds: [ids[5], ids[2]] });
  });
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toBeNull();
  expect(await placement(t, 2)).toBeNull();
});

test("one or two winners are enough", async () => {
  const { t } = setupTest();
  await finalNight(t, { placementIds: [3] });
  await finish(t);
  const results = (await t.query(api.events.getStage, { slug: "hack" })).results;
  expect(results?.winners).toEqual([{ place: 1, demoTitle: "Project 3", teamName: "Person 3" }]);
  expect(results?.finalists.map((finalist) => finalist.demoTitle)).toEqual(["Project 4", "Project 2", "Project 0", "Project 1"]);
  expect(await placement(t, 3)).toBe(1);
});

test("a finalist marked No-show, withdrawn or hidden is not listed among the finalists", async () => {
  const { t } = setupTest();
  const { ids } = await finalNight(t, { placementIds: [2] });
  await t.run(async (ctx) => {
    await ctx.db.patch(ids[3], { status: "no_show" });
    await ctx.db.patch(ids[0], { status: "withdrawn" });
    await ctx.db.patch(ids[1], { status: "hidden" });
  });
  await finish(t);
  const results = (await t.query(api.events.getStage, { slug: "hack" })).results;
  expect(results?.winners.map((winner) => winner.demoTitle)).toEqual(["Project 2"]);
  expect(results?.finalists.map((finalist) => finalist.demoTitle)).toEqual(["Project 4"]);
});

test("a demo night never has results", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { eventType: "demo", extra: { phase: "finished", finishedAt: 1, queuePublished: true } });
  await addProject(t, eventId, 0, { status: "done" });
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toBeNull();
  expect(await placement(t, 0)).toBeNull();
});

test("the organiser chooses winners and finalists or winners only, from the app or an assistant", async () => {
  const { root, t } = setupTest();
  await finalNight(t);
  await finish(t);
  expect((await t.query(api.events.getAdmin, { slug: "hack" })).event.stageResultsShowFinalists).toBe(true);

  await t.mutation(api.events.setStageResultsShowFinalists, { slug: "hack", showFinalists: false });
  expect((await t.query(api.events.getAdmin, { slug: "hack" })).event.stageResultsShowFinalists).toBe(false);
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toMatchObject({ showFinalists: false });
  const changes = await t.query(api.changes.listRecentChanges, { slug: "hack" });
  expect(changes.changes[0]).toMatchObject({ kind: "stage_results_finalists", summary: "set the stage to show only the winners at the end" });

  const principal = { organizationId: ORG, actor: `https://api.workos.com/user_management/client_test|${ACTOR_SUBJECT}` };
  await t.mutation(internal.mcpAdmin.setStageResultsShowFinalists, { principal, input: { slug: "hack", showFinalists: true } });
  expect((await t.query(api.events.getStage, { slug: "hack" })).results).toMatchObject({ showFinalists: true });

  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  await expect(outsider.mutation(api.events.setStageResultsShowFinalists, { slug: "hack", showFinalists: false })).rejects.toThrow("Unauthorized");
});
