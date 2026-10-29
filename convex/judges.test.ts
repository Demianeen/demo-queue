import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addProject, createEvent, judgeLink, openJudging, score, setupTest } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function judgedEvent() {
  const { root, t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  const tracks = await t.run(async (ctx) => [
    await ctx.db.insert("eventTracks", { eventId, name: "Developer tools", order: 0, createdAt: 1, updatedAt: 1 }),
    await ctx.db.insert("eventTracks", { eventId, name: "AI agents", order: 1, createdAt: 1, updatedAt: 1 }),
  ]);
  const projects: Id<"submissions">[] = [];
  for (let index = 0; index < 6; index += 1) {
    projects.push(await addProject(t, eventId, index, { trackIds: index % 3 === 0 ? [] : index % 3 === 1 ? [tracks[0]] : [tracks[0], tracks[1]] }));
  }
  const tokens = { alex: await judgeLink(t, "Alex"), sam: await judgeLink(t, "Sam"), taylor: await judgeLink(t, "Taylor") };
  await openJudging(t);
  const assigned = async (judge: string) =>
    (await t.run((ctx) => ctx.db.query("submissions").collect())).filter((row) => row.roundOneAssignedJudges?.includes(judge)).map((row) => row._id);
  return { root, t, eventId, tracks, projects, tokens, assigned };
}

test("the judge page asks for a name confirmation once and records it as Opened", async () => {
  const { t, tokens } = await judgedEvent();
  expect((await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex })).openedAt).toBeNull();
  const confirmed = await t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: tokens.alex });
  expect(confirmed).toEqual({ judgeName: "Alex", openedAt: Date.now() });
  vi.advanceTimersByTime(60_000);
  // Confirming again keeps the first time.
  expect((await t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: tokens.alex })).openedAt).toBe(confirmed.openedAt);
  await expect(t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: "wrong" })).rejects.toThrow("Unauthorized");
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.find((row) => row.judgeKey === "alex")).toMatchObject({ openedAt: confirmed.openedAt });
  expect(overview.judges.find((row) => row.judgeKey === "sam")).toMatchObject({ openedAt: null });
  expect(overview.totals).toMatchObject({ judges: 3, activeJudges: 3, openedJudges: 1 });
});

test("the judge page groups projects into Yours, Help out, Scored and All, with tracks", async () => {
  const { t, tokens, assigned, projects } = await judgedEvent();
  const alexOwn = await assigned("Alex");
  const others = projects.filter((id) => !alexOwn.includes(id));
  await score(t, tokens.alex, alexOwn[0], 7);
  // One of the others already has two complete reviews, so it is not in Help out.
  const full = others[0];
  const fullJudges = (await t.run((ctx) => ctx.db.get(full)))!.roundOneAssignedJudges!;
  for (const judge of fullJudges) await score(t, tokens[judge.toLowerCase() as "sam" | "taylor"], full, 6);

  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex });
  expect(page.counts).toEqual({ yours: alexOwn.length - 1, helpOut: others.length - 1, scored: 1, all: 6 });
  expect(page).toMatchObject({ yoursTotal: alexOwn.length, yoursScored: 1, canScore: true, judgingPaused: false, reviewTarget: 2, mainEventCount: 2 });
  expect(page.tracks).toEqual([
    { id: expect.any(String), name: "Developer tools", description: null, count: 4 },
    { id: expect.any(String), name: "AI agents", description: null, count: 2 },
  ]);
  const fullRow = page.projects.find((row) => row.id === full)!;
  expect(fullRow).toMatchObject({ group: "other", completeReviewCount: 2, needsReview: false, assignedToMe: false });
  const mine = page.projects.find((row) => row.id === alexOwn[0])!;
  expect(mine).toMatchObject({ group: "scored", assignedToMe: true, review: { innovation: 7, completed: true } });
  for (const row of page.projects) expect(Array.isArray(row.trackIds)).toBe(true);
  expect(JSON.stringify(page)).not.toMatch(/@example\.com|\+44|participant-/);

  // Helping out counts as Alex's own review, in judging progress too.
  const help = page.projects.find((row) => row.group === "helpOut")!;
  await score(t, tokens.alex, help.id, 8);
  const progress = await t.query(api.judging.getAdminProgress, { slug: "hack" });
  expect(progress.scoring.find((row) => row.submissionId === help.id)).toMatchObject({ completeReviewCount: 1 });
  expect(progress.tracks.map((track) => track.name)).toEqual(["Developer tools", "AI agents"]);
  for (const row of progress.scoring) expect(row.tracks).toHaveLength((page.projects.find((project) => project.id === row.submissionId)!.trackIds).length);
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.find((row) => row.judgeKey === "alex")).toMatchObject({ assignedCount: alexOwn.length, assignedScoredCount: 1, helpedCount: 1 });
});

test("the judges table lists every judge's link, counts and totals", async () => {
  const { t, tokens, assigned } = await judgedEvent();
  const samOwn = await assigned("Sam");
  await score(t, tokens.sam, samOwn[0], 5);
  await t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.sam, submissionId: samOwn[1], innovation: 5 });
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.map((row) => row.judgeName)).toEqual(["Alex", "Sam", "Taylor"]);
  expect(overview.judges.find((row) => row.judgeKey === "sam")).toMatchObject({
    hasLink: true, active: true, path: `/judge/hack/${tokens.sam}`, assignedScoredCount: 1, helpedCount: 0, inProgressCount: 1, lastScoredAt: Date.now(),
  });
  expect(overview.totals).toMatchObject({ projects: 6, completeReviews: 1, targetReviews: 12, fullyReviewedProjects: 0 });
});

test("replacing a link stops the old one, clears Opened, and keeps the scores", async () => {
  const { t, tokens, assigned } = await judgedEvent();
  await t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: tokens.alex });
  await score(t, tokens.alex, (await assigned("Alex"))[0], 9);
  const result = await t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "alex", capabilityToken: "fresh-alex-token-0001" });
  expect(result).toEqual({ judgeKey: "alex", path: "/judge/hack/fresh-alex-token-0001" });
  await expect(t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex })).rejects.toThrow("Unauthorized");
  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: "fresh-alex-token-0001" });
  expect(page).toMatchObject({ judgeName: "Alex", openedAt: null, counts: { scored: 1 } });
  await expect(t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "alex", capabilityToken: tokens.sam })).rejects.toThrow("already in use");
  await expect(t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "alex", capabilityToken: "short" })).rejects.toThrow("too short");
  await expect(t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "nobody", capabilityToken: "fresh-nobody-token-01" })).rejects.toThrow("Judge not found.");
});

test("moving scores refuses a project both judges scored, and moves the rest", async () => {
  const { t, tokens, assigned } = await judgedEvent();
  const alexOwn = await assigned("Alex");
  for (const id of alexOwn) await score(t, tokens.alex, id, 7);
  await score(t, tokens.taylor, alexOwn[0], 4);
  await expect(t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "alex", toJudgeKey: "taylor" })).rejects.toThrow(/Taylor already scored Project \d\. Leave those out/);
  expect(await t.run((ctx) => ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q).collect())).toHaveLength(alexOwn.length + 1);
  // The judges table lists each judge's reviewed projects, so the dialog can show the clash and leave it out.
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  const row = (key: string) => overview.judges.find((judge) => judge.judgeKey === key)!;
  expect(row("alex").reviewedProjects.map((project) => project.submissionId).sort()).toEqual([...alexOwn].sort());
  expect(row("taylor").reviewedProjects).toEqual([{ submissionId: alexOwn[0], demoTitle: expect.stringMatching(/^Project \d$/) }]);
  const result = await t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "alex", toJudgeKey: "taylor", submissionIds: alexOwn.slice(1) });
  expect(result).toEqual({ moved: alexOwn.length - 1 });
  const reviews = await t.run((ctx) => ctx.db.query("reviews").collect());
  expect(reviews.filter((review) => review.judgeKey === "alex").map((review) => review.submissionId)).toEqual([alexOwn[0]]);
  await expect(t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "alex", toJudgeKey: "alex" })).rejects.toThrow("Choose another judge");
  await expect(t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "sam", toJudgeKey: "alex" })).rejects.toThrow("Sam has no scores to move.");
});

test("judges outside the organization cannot reach the judges table", async () => {
  const { root } = await judgedEvent();
  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  await expect(outsider.query(api.judging.getJudgesOverview, { slug: "hack" })).rejects.toThrow("Unauthorized");
  await expect(outsider.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "alex", capabilityToken: "outsider-token-00001" })).rejects.toThrow("Unauthorized");
  await expect(outsider.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "alex", toJudgeKey: "sam" })).rejects.toThrow("Unauthorized");
});

test("scores stay whole numbers from 0 to 10", async () => {
  const { t, tokens, projects } = await judgedEvent();
  await expect(t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.alex, submissionId: projects[0], innovation: 7.5 })).rejects.toThrow("whole numbers from 0 to 10");
  await expect(t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.alex, submissionId: projects[0], innovation: 11 })).rejects.toThrow("whole numbers from 0 to 10");
});
