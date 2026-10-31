import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACTOR_SUBJECT, ORG, addProject, createEvent, judgeKeys, openJudging, score, setupTest, type TestClient } from "./behaviour.testing";

// A judge is their key: made once when they are added, never worked out from
// their name again. See docs/judge-identity.md.

const actor = `https://api.workos.com/user_management/client_test|${ACTOR_SUBJECT}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T18:00:00Z"));
  vi.stubEnv("WORKOS_API_KEY", "test-workos-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: ACTOR_SUBJECT, email: "demian@example.com" }), { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const recent = async (t: TestClient) => (await t.query(api.changes.listRecentChanges, { slug: "hack" })).changes;
const names = async (t: TestClient) => (await t.query(api.judging.getJudgesOverview, { slug: "hack" })).judges.map((judge) => judge.judgeName);
const roster = async (t: TestClient, eventId: Id<"events">) => (await t.run((ctx) => ctx.db.get(eventId)))!.roundOneJudges;

/**
 * An event set up before judges had ids, as it is stored in production: the
 * roster and every assignment hold the judges' names, and each link's key is
 * the name normalized ("test judge c"). Nothing is migrated.
 */
async function oldShapeEvent() {
  const { t } = setupTest();
  const judges = ["Alex", "Sam", "Test judge C", "Jo"];
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "DevDay Exchange", slug: "hack", eventType: "hackathon", workosOrganizationId: ORG,
    meetUrl: "https://meet.example", queuePublished: false, roundOneJudges: judges, createdAt: 1, updatedAt: 1,
  }));
  const tokens: Record<string, string> = {};
  for (const judgeName of judges) {
    const token = `${judgeName.toLowerCase().replace(/\s+/g, "-")}-secret-token`;
    tokens[judgeName] = token;
    await t.run((ctx) => ctx.db.insert("judgeAccess", {
      eventId, judgeKey: judgeName.toLowerCase(), judgeName, token, active: true, createdAt: 1, updatedAt: 1,
    }));
  }
  const projects: Id<"submissions">[] = [];
  for (let index = 0; index < 8; index += 1) projects.push(await addProject(t, eventId, index));
  await openJudging(t);
  const assignments = async () => new Map((await t.run((ctx) => ctx.db.query("submissions").collect())).map((row) => [row._id, row.roundOneAssignedJudges ?? []]));
  return { t, eventId, tokens, projects, assignments };
}

test("an event set up before judges had ids keeps working: scoring, progress, Help out, redistribution, move scores and rename", async () => {
  const { t, eventId, tokens, projects, assignments } = await oldShapeEvent();
  // Assignments are stored as names, the way the roster is.
  const assigned = await assignments();
  expect([...assigned.values()].every((pair) => pair.length === 2 && pair.every((name) => ["Alex", "Sam", "Test judge C", "Jo"].includes(name)))).toBe(true);
  const ownOf = (name: string) => projects.filter((id) => assigned.get(id)!.includes(name));

  // Scoring and progress.
  const cOwn = ownOf("Test judge C");
  await score(t, tokens["Test judge C"], cOwn[0], 7);
  const page = await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens["Test judge C"] });
  expect(page.projects.filter((row) => row.assignedToMe).map((row) => row.id).sort()).toEqual([...cOwn].sort());
  const progress = await t.query(api.judging.getAdminProgress, { slug: "hack" });
  const row = progress.scoring.find((item) => item.submissionId === cOwn[0])!;
  expect(row.assignedJudgeKeys).toContain("test judge c");
  expect(row.assignedJudges).toContain("Test judge C");
  expect(progress.reviews).toContainEqual(expect.objectContaining({ judgeKey: "test judge c", judgeName: "Test judge C", completed: true }));

  // Rename: the case that failed. The key stays, so nothing else moves.
  await t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: "test judge c", name: "Test judge" });
  expect(await roster(t, eventId)).toEqual(["Alex", "Sam", "Test judge C", "Jo"]);
  expect(await assignments()).toEqual(assigned);
  expect(await names(t)).toEqual(["Alex", "Sam", "Test judge", "Jo"]);
  const overview = await t.query(api.judging.getJudgesOverview, { slug: "hack" });
  expect(overview.judges.find((judge) => judge.judgeKey === "test judge c")).toMatchObject({ judgeName: "Test judge", assignedCount: cOwn.length, assignedScoredCount: 1, active: true });
  // Their link still works and greets them by their new name.
  expect(await t.query(api.judging.getJudgeWorkspace, { slug: "hack", capabilityToken: tokens["Test judge C"] })).toMatchObject({ judgeName: "Test judge" });
  expect((await t.query(api.judging.getAdminProgress, { slug: "hack" })).scoring.find((item) => item.submissionId === cOwn[0])!.assignedJudges).toContain("Test judge");

  // Move scores.
  const samOwn = ownOf("Sam").filter((id) => !assigned.get(id)!.includes("Alex"));
  await score(t, tokens.Alex, samOwn[0], 5);
  await t.mutation(api.judging.moveJudgeScores, { slug: "hack", fromJudgeKey: "alex", toJudgeKey: "sam", submissionIds: [samOwn[0]] });
  expect((await t.run((ctx) => ctx.db.query("reviews").collect())).find((review) => review.submissionId === samOwn[0])).toMatchObject({ judgeKey: "sam" });

  // Redistribution: Jo turns off, their unscored projects go to judges who are on.
  const preview = await t.query(api.judging.previewRedistribution, { slug: "hack", unavailableJudgeKey: "jo" });
  expect(preview.length).toBe(ownOf("Jo").length);
  for (const item of preview) {
    expect(item.judges).not.toContain("jo");
    expect(item.judgeNames.every((name) => ["Alex", "Sam", "Test judge"].includes(name))).toBe(true);
  }
  await t.mutation(api.judging.applyRedistribution, { slug: "hack", unavailableJudgeKey: "jo", assignments: preview.map(({ submissionId, judges }) => ({ submissionId, judges })) });
  const after = await assignments();
  // The event keeps one shape: assignments are still names, never Jo, and the renamed judge keeps the name they were stored under.
  for (const pair of after.values()) {
    expect(pair).not.toContain("Jo");
    expect(pair.every((name) => ["Alex", "Sam", "Test judge C"].includes(name))).toBe(true);
  }
});

test("renaming a judge refuses an empty name or another judge's name, and keeps their link, projects and scores", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  for (let index = 0; index < 4; index += 1) await addProject(t, eventId, index);
  await openJudging(t);
  const keys = await judgeKeys(t);
  const link = (await t.run((ctx) => ctx.db.query("judgeAccess").collect())).find((row) => row.judgeKey === keys.taylor)!;
  const project = (await t.run((ctx) => ctx.db.query("submissions").collect())).find((row) => row.roundOneAssignedJudges!.includes(keys.taylor))!._id;
  await score(t, link.token, project, 6);
  const before = await t.run((ctx) => ctx.db.query("submissions").collect());

  await expect(t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: keys.taylor, name: "   " })).rejects.toThrow("name");
  // Another judge's name, in any case or spacing.
  await expect(t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: keys.taylor, name: "  sAm " })).rejects.toThrow("Another judge is already called Sam.");
  await expect(t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: "j_000000000000", name: "Jo" })).rejects.toThrow("Judge not found");

  expect(await t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: keys.taylor, name: "  Taylor   Swift " })).toEqual({ judgeKey: keys.taylor, judgeName: "Taylor Swift" });
  expect(await t.run((ctx) => ctx.db.get(link._id))).toMatchObject({ judgeKey: keys.taylor, judgeName: "Taylor Swift", token: link.token, active: true });
  expect(await t.run((ctx) => ctx.db.query("submissions").collect())).toEqual(before);
  expect((await t.run((ctx) => ctx.db.query("reviews").collect())).map((review) => review.judgeKey)).toEqual([keys.taylor]);
  expect(await names(t)).toEqual(["Alex", "Sam", "Taylor Swift"]);
  // A different case of their own name is fine.
  await t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: keys.taylor, name: "taylor swift" });
  const [renamed] = await recent(t);
  expect(renamed).toMatchObject({ summary: "renamed Taylor Swift to taylor swift", canUndo: true });
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: renamed.id });
  expect(await names(t)).toEqual(["Alex", "Sam", "Taylor Swift"]);
});

test("rename_judge, add_judges and remove_judge do what the app does", async () => {
  // Two events in one test database: one changed in the app, one by the tools.
  const { t } = setupTest();
  const approvalId = await t.run((ctx) => ctx.db.insert("mcpApprovals", {
    ownerAccountKey: `workos:client_test:${ACTOR_SUBJECT}`, workosUserId: ACTOR_SUBJECT, actor, source: "apiKey", name: "Test assistant",
    access: "manage", requestedScopes: ["events:manage"], approvedScopes: ["events:manage"], allOrganizations: true,
  }));
  const principal = { organizationId: ORG, actor, mcp: { approvalId, scope: "events:manage" } };
  const app = await createEvent(t, { slug: "hack", judges: ["Alex", "Sam"] });
  const mcp = await createEvent(t, { slug: "hack-mcp", judges: ["Alex", "Sam"] });
  const shape = async ({ eventId, slug }: typeof app) => {
    const links = (await t.run((ctx) => ctx.db.query("judgeAccess").collect())).filter((row) => row.eventId === eventId);
    const nameOf = new Map(links.map((row) => [row.judgeKey, row.judgeName]));
    return {
      roster: (await roster(t, eventId))!.map((key) => nameOf.get(key)),
      links: links.map(({ judgeName, active }) => ({ judgeName, active })),
      changes: (await t.query(api.changes.listRecentChanges, { slug })).changes.map((change) => change.summary),
    };
  };

  const names = ["Jo", "alex", "Kim\n"];
  const added = await t.mutation(api.judging.addJudges, { slug: app.slug, names });
  const addedByTool = await t.mutation(internal.mcpAdmin.addJudges, { principal, input: { slug: mcp.slug, names } });
  expect(added.added.map((judge) => judge.judgeName)).toEqual(["Jo", "Kim"]);
  expect(addedByTool.added.map((judge) => judge.judgeName)).toEqual(["Jo", "Kim"]);
  expect(added.skipped).toEqual(addedByTool.skipped);

  const appKeys = await judgeKeys(t, app.slug);
  await t.mutation(api.judging.renameJudge, { slug: app.slug, judgeKey: appKeys.jo, name: "Joanna" });
  await t.mutation(api.judging.removeJudge, { slug: app.slug, judgeKey: appKeys.kim });
  const mcpKeys = await judgeKeys(t, mcp.slug);
  await t.mutation(internal.mcpAdmin.renameJudge, { principal, input: { slug: mcp.slug, judgeKey: mcpKeys.jo, name: "Joanna" } });
  await t.mutation(internal.mcpAdmin.removeJudge, { principal, input: { slug: mcp.slug, judgeKey: mcpKeys.kim } });
  await expect(t.mutation(internal.mcpAdmin.renameJudge, { principal, input: { slug: mcp.slug, judgeKey: mcpKeys.alex, name: "joanna" } })).rejects.toThrow("Another judge is already called Joanna.");

  const appShape = await shape(app);
  expect(appShape).toEqual(await shape(mcp));
  expect(appShape).toMatchObject({
    roster: ["Alex", "Sam", "Joanna"],
    changes: ["removed Kim", "renamed Jo to Joanna", "added 2 judges", "updated the judges"],
  });
  expect(appShape.links).toContainEqual({ judgeName: "Kim", active: false });
});

test("adding judges makes their links, and a judge with scores can't be removed, only turned off", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  for (let index = 0; index < 6; index += 1) await addProject(t, eventId, index);
  await openJudging(t);
  const keys = await judgeKeys(t);
  expect(Object.keys(keys).sort()).toEqual(["alex", "sam", "taylor"]);
  expect(Object.values(keys).every((key) => /^j_[0-9a-f]{12}$/.test(key))).toBe(true);

  const added = await t.mutation(api.judging.addJudges, { slug: "hack", names: ["Jo", "Sam"] });
  expect(added).toMatchObject({ added: [{ judgeName: "Jo" }], skipped: ["Sam"] });
  const jo = added.added[0].judgeKey;
  expect(await names(t)).toEqual(["Alex", "Sam", "Taylor", "Jo"]);

  const taylor = (await t.run((ctx) => ctx.db.query("judgeAccess").collect())).find((row) => row.judgeKey === keys.taylor)!;
  const taylorOwn = (await t.run((ctx) => ctx.db.query("submissions").collect())).filter((row) => row.roundOneAssignedJudges!.includes(keys.taylor));
  await score(t, taylor.token, taylorOwn[0]._id, 6);
  await expect(t.mutation(api.judging.removeJudge, { slug: "hack", judgeKey: keys.taylor })).rejects.toThrow("Taylor has scores, so they can't be removed. Turn them off instead: their scores stay.");

  // Alex has no scores: their projects go to judges who are on, never to themselves.
  const alexOwn = (await t.run((ctx) => ctx.db.query("submissions").collect())).filter((row) => row.roundOneAssignedJudges!.includes(keys.alex));
  const removed = await t.mutation(api.judging.removeJudge, { slug: "hack", judgeKey: keys.alex });
  expect(removed.reassignedSubmissionIds.length).toBe(alexOwn.length);
  for (const row of await t.run((ctx) => ctx.db.query("submissions").collect())) {
    expect(row.roundOneAssignedJudges).not.toContain(keys.alex);
    expect(new Set(row.roundOneAssignedJudges).size).toBe(2);
  }
  expect(await roster(t, eventId)).toEqual([keys.sam, keys.taylor, jo]);
  expect(await names(t)).toEqual(["Sam", "Taylor", "Jo"]);
  // Their link is kept, turned off, so undo can bring them back.
  expect((await t.run((ctx) => ctx.db.query("judgeAccess").collect())).find((row) => row.judgeKey === keys.alex)).toMatchObject({ active: false });

  // Adding them back by name brings back the same judge and link.
  const back = await t.mutation(api.judging.addJudges, { slug: "hack", names: ["alex"] });
  expect(back.added).toEqual([{ judgeKey: keys.alex, judgeName: "Alex" }]);
  expect((await t.run((ctx) => ctx.db.query("judgeAccess").collect())).find((row) => row.judgeKey === keys.alex)).toMatchObject({ active: true });
});

test("a judge's evening-out decision survives a rename, because it is kept by their key", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam"] });
  const projects = [await addProject(t, eventId, 0), await addProject(t, eventId, 1)];
  await openJudging(t);
  const keys = await judgeKeys(t);
  const links = await t.run((ctx) => ctx.db.query("judgeAccess").collect());
  for (const link of links) for (const project of projects) await score(t, link.token, project, link.judgeKey === keys.alex ? 8 : 5);
  await t.mutation(api.judging.closeJudging, { slug: "hack" });
  await t.mutation(api.judging.saveNormalizationDecision, { slug: "hack", judgeKey: keys.sam, decision: "raw" });

  await t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: keys.sam, name: "Samantha" });
  const overview = await t.query(api.judging.getNormalizationOverview, { slug: "hack" });
  expect(overview.judges.find((judge) => judge.judgeKey === keys.sam)).toMatchObject({
    judgeName: "Samantha", completeReviewCount: 2, decision: { decision: "raw", stale: false }, effectiveDecision: "raw",
  });
  expect(overview.scoreBasisReady).toBe(true);
});

test("undo after a rename restores the roster without bringing back an old name, on old and new events", async () => {
  // An old event: the remove change keeps the roster as names, as changes recorded before judges had ids do.
  const old = await oldShapeEvent();
  await old.t.mutation(api.judging.removeJudge, { slug: "hack", judgeKey: "jo" });
  const [removedOld] = await recent(old.t);
  expect(removedOld).toMatchObject({ summary: "removed Jo", canUndo: true });
  await old.t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: "test judge c", name: "Test judge" });
  expect((await recent(old.t)).find((change) => change.id === removedOld.id)).toMatchObject({ canUndo: true });
  await old.t.mutation(api.changes.undoChange, { slug: "hack", changeId: removedOld.id });
  expect(await roster(old.t, old.eventId)).toEqual(["Alex", "Sam", "Test judge C", "Jo"]);
  expect(await names(old.t)).toEqual(["Alex", "Sam", "Test judge", "Jo"]);

  // A new event: the roster holds keys, so an undo can't write a name into it at all.
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { judges: ["Alex", "Sam", "Taylor"] });
  const keys = await judgeKeys(t);
  await t.mutation(api.judging.removeJudge, { slug: "hack", judgeKey: keys.taylor });
  const [removed] = await recent(t);
  await t.mutation(api.judging.renameJudge, { slug: "hack", judgeKey: keys.alex, name: "Alexandra" });
  await t.mutation(api.changes.undoChange, { slug: "hack", changeId: removed.id });
  expect(await roster(t, eventId)).toEqual([keys.alex, keys.sam, keys.taylor]);
  expect(await names(t)).toEqual(["Alexandra", "Sam", "Taylor"]);
});
