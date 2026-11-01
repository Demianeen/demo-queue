import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addProject, createEvent, judgeKeys, judgeLink, openJudging, score, setupTest } from "./behaviour.testing";

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
  const keys = await judgeKeys(t);
  const assigned = async (judge: string) =>
    (await t.run((ctx) => ctx.db.query("submissions").collect())).filter((row) => row.roundOneAssignedJudges?.includes(keys[judge.toLowerCase()])).map((row) => row._id);
  return { root, t, eventId, tracks, projects, tokens, keys, assigned };
}

test("the judge page asks for a name confirmation once and records it as Opened", async () => {
  const { t, tokens, keys } = await judgedEvent();
  expect((await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex })).openedAt).toBeNull();
  const confirmed = await t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: tokens.alex });
  expect(confirmed).toEqual({ judgeName: "Alex", openedAt: Date.now() });
  vi.advanceTimersByTime(60_000);
  // Confirming again keeps the first time.
  expect((await t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: tokens.alex })).openedAt).toBe(confirmed.openedAt);
  await expect(t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: "wrong" })).rejects.toThrow("Unauthorized");
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.find((row) => row.judgeKey === keys.alex)).toMatchObject({ openedAt: confirmed.openedAt });
  expect(overview.judges.find((row) => row.judgeKey === keys.sam)).toMatchObject({ openedAt: null });
  expect(overview.totals).toMatchObject({ judges: 3, activeJudges: 3, openedJudges: 1 });
});

test("the judge page groups projects into Yours, Help out, Scored and All, with tracks", async () => {
  const { t, tokens, keys, assigned, projects } = await judgedEvent();
  const alexOwn = await assigned("Alex");
  const others = projects.filter((id) => !alexOwn.includes(id));
  await score(t, tokens.alex, alexOwn[0], 7);
  // One of the others already has two complete reviews, so it is not in Help out.
  const full = others[0];
  const fullJudges = (await t.run((ctx) => ctx.db.get(full)))!.roundOneAssignedJudges!;
  for (const judge of fullJudges) await score(t, tokens[judge === keys.sam ? "sam" : "taylor"], full, 6);

  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex });
  expect(page.counts).toEqual({ yours: alexOwn.length - 1, covered: 0, helpOut: others.length - 1, scored: 1, all: 6 });
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
  expect(overview.judges.find((row) => row.judgeKey === keys.alex)).toMatchObject({ assignedCount: alexOwn.length, assignedScoredCount: 1, helpedCount: 1 });
});

type Judge = "alex" | "sam" | "taylor";

test("a project two others reviewed is covered: it leaves Yours and its judge's count until they start it", async () => {
  const { t, tokens, keys, assigned } = await judgedEvent();
  const samOwn = await assigned("Sam");
  const project = samOwn[0];
  const otherKey = (await t.run((ctx) => ctx.db.get(project)))!.roundOneAssignedJudges!.find((judge) => judge !== keys.sam)!;
  const other: Judge = otherKey === keys.alex ? "alex" : "taylor";
  const helper: Judge = other === "alex" ? "taylor" : "alex";
  await score(t, tokens[other], project, 6);
  await score(t, tokens[helper], project, 8);

  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.sam });
  expect(page.projects.find((row) => row.id === project)).toMatchObject({ group: "covered", assignedToMe: true, coveredBy: [helper === "alex" ? "Alex" : "Taylor"], completeReviewCount: 2 });
  expect(page).toMatchObject({ yoursTotal: samOwn.length - 1, counts: { yours: samOwn.length - 1, covered: 1 } });
  expect(page.judges.find((judge) => judge.judgeKey === keys.sam)).toMatchObject({ judgeName: "Sam", left: samOwn.length - 1 });
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.find((row) => row.judgeKey === keys.sam)).toMatchObject({ assignedCount: samOwn.length, leftCount: samOwn.length - 1 });

  // Once Sam starts it, it is his again.
  await t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.sam, submissionId: project, innovation: 5 });
  const after = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.sam });
  expect(after.projects.find((row) => row.id === project)).toMatchObject({ group: "yours", coveredBy: [] });
  expect(after).toMatchObject({ yoursTotal: samOwn.length, counts: { covered: 0 } });
});

test("Help out says whose project each one helps, and lists other judges' unfinished reviews with when they saved", async () => {
  const { t, tokens, keys, assigned, projects } = await judgedEvent();
  const alexOwn = await assigned("Alex");
  const others = projects.filter((id) => !alexOwn.includes(id));
  // Sam finishes one of the Sam and Taylor projects, so it waits on Taylor.
  await score(t, tokens.sam, others[0], 7);
  vi.advanceTimersByTime(60_000);
  // Taylor starts the other one.
  await t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.taylor, submissionId: others[1], execution: 4 });

  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex });
  expect(page.projects.find((row) => row.id === others[0])).toMatchObject({ group: "helpOut", helpFor: keys.taylor, scorers: [] });
  expect(page.projects.find((row) => row.id === others[1])).toMatchObject({
    group: "helpOut",
    scorers: [{ judgeKey: keys.taylor, judgeName: "Taylor", updatedAt: Date.now(), assigned: true }],
  });
  // Alex's own projects never say whom they help.
  for (const id of alexOwn) expect(page.projects.find((row) => row.id === id)!.helpFor).toBeNull();
  const left = Object.fromEntries(page.judges.map((judge) => [judge.judgeKey, judge.left]));
  expect(left).toEqual({ [keys.alex]: alexOwn.length, [keys.sam]: (await assigned("Sam")).length - 1, [keys.taylor]: (await assigned("Taylor")).length });
  // Taylor has more left than Sam now, so a project neither finished goes to Taylor.
  expect(page.projects.find((row) => row.id === others[1])!.helpFor).toBe(keys.taylor);
});

test("the judges table shows what each judge has left and who is behind", async () => {
  const { t, tokens, keys, assigned } = await judgedEvent();
  const alexOwn = await assigned("Alex");
  const taylorOwn = await assigned("Taylor");
  const samOwn = await assigned("Sam");
  for (const id of alexOwn) await score(t, tokens.alex, id, 7);
  for (const id of taylorOwn) await score(t, tokens.taylor, id, 6);
  const row = async (key: string) => (await t.query(api.judging.getJudgesOverview, { slug: "hack" })).judges.find((judge) => judge.judgeKey === key)!;
  // Sam's projects each have one review from the other judge, so none is covered.
  expect(await row(keys.sam)).toMatchObject({ leftCount: samOwn.length, behind: samOwn.length >= 4 });
  expect(await row(keys.alex)).toMatchObject({ leftCount: 0, behind: false, helpedCount: 0 });

  // Alex helps on a Sam and Taylor project: it has two reviews, so it is covered for Sam.
  const shared = samOwn.find((id) => taylorOwn.includes(id))!;
  await score(t, tokens.alex, shared, 8);
  expect(await row(keys.alex)).toMatchObject({ leftCount: 0, helpedCount: 1 });
  expect(await row(keys.sam)).toMatchObject({ leftCount: samOwn.length - 1, behind: samOwn.length - 1 >= 4 });
});

test("the judges table lists every judge's link, counts and totals", async () => {
  const { t, tokens, keys, assigned } = await judgedEvent();
  const samOwn = await assigned("Sam");
  await score(t, tokens.sam, samOwn[0], 5);
  await t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.sam, submissionId: samOwn[1], innovation: 5 });
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.map((row) => row.judgeName)).toEqual(["Alex", "Sam", "Taylor"]);
  expect(overview.judges.find((row) => row.judgeKey === keys.sam)).toMatchObject({
    hasLink: true, active: true, path: `/judge/hack/${tokens.sam}`, assignedScoredCount: 1, helpedCount: 0, inProgressCount: 1, lastScoredAt: Date.now(),
  });
  expect(overview.totals).toMatchObject({ projects: 6, completeReviews: 1, targetReviews: 12, fullyReviewedProjects: 0 });
});

test("replacing a link stops the old one, clears Opened, and keeps the scores", async () => {
  const { t, tokens, keys, assigned } = await judgedEvent();
  await t.mutation(api.judging.confirmJudge, { slug: "hack", capabilityToken: tokens.alex });
  await score(t, tokens.alex, (await assigned("Alex"))[0], 9);
  const result = await t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: keys.alex, capabilityToken: "fresh-alex-token-0001" });
  expect(result).toEqual({ judgeKey: keys.alex, path: "/judge/hack/fresh-alex-token-0001" });
  await expect(t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens.alex })).rejects.toThrow("Unauthorized");
  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: "fresh-alex-token-0001" });
  expect(page).toMatchObject({ judgeName: "Alex", openedAt: null, counts: { scored: 1 } });
  await expect(t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: keys.alex, capabilityToken: tokens.sam })).rejects.toThrow("already in use");
  await expect(t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: keys.alex, capabilityToken: "short" })).rejects.toThrow("too short");
  await expect(t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: "nobody", capabilityToken: "fresh-nobody-token-01" })).rejects.toThrow("Judge not found.");
});

test("moving scores refuses a project both judges scored, and moves the rest", async () => {
  const { t, tokens, keys, assigned } = await judgedEvent();
  const alexOwn = await assigned("Alex");
  for (const id of alexOwn) await score(t, tokens.alex, id, 7);
  await score(t, tokens.taylor, alexOwn[0], 4);
  await expect(t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: keys.alex, toJudgeKey: keys.taylor })).rejects.toThrow(/Taylor already scored Project \d\. Leave those out/);
  expect(await t.run((ctx) => ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q).collect())).toHaveLength(alexOwn.length + 1);
  // The judges table lists each judge's reviewed projects, so the dialog can show the clash and leave it out.
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  const row = (key: string) => overview.judges.find((judge) => judge.judgeKey === key)!;
  expect(row(keys.alex).reviewedProjects.map((project) => project.submissionId).sort()).toEqual([...alexOwn].sort());
  expect(row(keys.taylor).reviewedProjects).toEqual([{ submissionId: alexOwn[0], demoTitle: expect.stringMatching(/^Project \d$/) }]);
  const result = await t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: keys.alex, toJudgeKey: keys.taylor, submissionIds: alexOwn.slice(1) });
  expect(result).toEqual({ moved: alexOwn.length - 1 });
  const reviews = await t.run((ctx) => ctx.db.query("reviews").collect());
  expect(reviews.filter((review) => review.judgeKey === keys.alex).map((review) => review.submissionId)).toEqual([alexOwn[0]]);
  await expect(t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: keys.alex, toJudgeKey: keys.alex })).rejects.toThrow("Choose another judge");
  await expect(t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: keys.sam, toJudgeKey: keys.alex })).rejects.toThrow("Sam has no scores to move.");
});

test("judges outside the organization cannot reach the judges table", async () => {
  const { root, keys } = await judgedEvent();
  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  await expect(outsider.query(api.judging.getJudgesOverview, { slug: "hack" })).rejects.toThrow("Unauthorized");
  await expect(outsider.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: keys.alex, capabilityToken: "outsider-token-00001" })).rejects.toThrow("Unauthorized");
  await expect(outsider.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: keys.alex, toJudgeKey: keys.sam })).rejects.toThrow("Unauthorized");
});

test("scores stay whole numbers from 0 to 10", async () => {
  const { t, tokens, projects } = await judgedEvent();
  await expect(t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.alex, submissionId: projects[0], innovation: 7.5 })).rejects.toThrow("whole numbers from 0 to 10");
  await expect(t.mutation(api.judging.saveReview, { slug: "hack", capabilityToken: tokens.alex, submissionId: projects[0], innovation: 11 })).rejects.toThrow("whole numbers from 0 to 10");
});
