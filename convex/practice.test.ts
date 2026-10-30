import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { ACTOR_SUBJECT, ORG, addProject, createEvent, setupTest, type TestClient } from "./behaviour.testing";
import { PRACTICE_PROJECTS, PRACTICE_VIDEOS, plusAddress } from "./practice";
import { videoEmbedUrl } from "../lib/video-embed";

const OWNER_EMAIL = "Demian@Example.com";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
  vi.stubEnv("WORKOS_API_KEY", "test-workos-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === `https://api.workos.com/user_management/users/${ACTOR_SUBJECT}`) {
      return new Response(JSON.stringify({ id: ACTOR_SUBJECT, email: OWNER_EMAIL, first_name: "Demian" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function liveHackathon(t: TestClient) {
  const { eventId } = await createEvent(t, {
    slug: "devday", judges: ["Alex", "Sam"],
    extra: { name: "DevDay Exchange", judgingTimerDurationMs: 30 * 60_000, stageTimerDurationMs: 4 * 60_000, lineupTarget: 12, aiSummarySections: [{ key: "pitch", label: "Pitch", instruction: "One line pitch." }] },
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("eventTracks", { eventId, name: "Developer tools", order: 0, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("eventTracks", { eventId, name: "AI agents", description: "Agents that do work", order: 1, createdAt: 1, updatedAt: 1 });
  });
  await addProject(t, eventId, 0);
  return eventId;
}

const practiceRows = (t: TestClient) => t.query(api.practice.listPracticeEvents, {});

test("plus-addresses keep the domain and drop an existing tag", () => {
  expect(plusAddress("ana@example.com", "dq-test-3")).toBe("ana+dq-test-3@example.com");
  expect(plusAddress("ana+events@example.com", "dq-test-3")).toBe("ana+dq-test-3@example.com");
  expect(() => plusAddress("nobody", "x")).toThrow("plus-address");
});

test("a copy of the live event brings its setup, test judges and test submissions, and stays apart", async () => {
  const { t } = setupTest();
  const liveId = await liveHackathon(t);
  const created = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "copy", slug: "devday" }, testSubmissions: 6, testJudges: 3 });
  expect(created).toMatchObject({ judges: ["Test judge A", "Test judge B", "Test judge C"], submissionCount: 6 });
  expect(created.slug).toMatch(/^practice-dry-run-for-devday-exchange-[a-z0-9]{5}$/);

  const event = (await t.run((ctx) => ctx.db.get(created.eventId)))!;
  expect(event).toMatchObject({
    practice: true, practiceOwnerEmail: "demian@example.com", practiceCopiedFromEventId: liveId, practiceCopiedFromName: "DevDay Exchange",
    eventType: "hackathon", judgingTimerDurationMs: 30 * 60_000, stageTimerDurationMs: 4 * 60_000, lineupTarget: 12, phase: "submissions",
    aiSummarySections: [{ key: "pitch", label: "Pitch", instruction: "One line pitch." }],
    roundOneJudges: ["Test judge A", "Test judge B", "Test judge C"],
  });
  const [tracks, submissions, links, members, audit] = await t.run(async (ctx) => [
    await ctx.db.query("eventTracks").withIndex("by_event_and_order", (q) => q.eq("eventId", created.eventId)).collect(),
    await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", created.eventId)).collect(),
    await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", created.eventId)).collect(),
    await ctx.db.query("teamMembers").withIndex("by_event", (q) => q.eq("eventId", created.eventId)).collect(),
    await ctx.db.query("auditLog").withIndex("by_event_and_action", (q) => q.eq("eventId", created.eventId).eq("action", "test_submission_admin_added")).collect(),
  ] as const);
  expect(tracks.map((track) => track.name)).toEqual(["Developer tools", "AI agents"]);
  expect(links).toHaveLength(3);
  expect(submissions).toHaveLength(6);
  expect(audit).toHaveLength(6);
  // Every test person's email arrives in the creator's inbox.
  for (const email of [...submissions.map((row) => row.normalizedEmail), ...members.map((row) => row.normalizedEmail)]) {
    expect(email).toMatch(/^demian\+dq-test-\d+@example\.com$/);
  }
  expect(new Set(submissions.map((row) => row.normalizedEmail)).size).toBe(6);
  for (const row of submissions) {
    expect(row).toMatchObject({ status: "candidate", githubUrl: expect.stringMatching(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/), videoUrl: expect.stringMatching(/^https:\/\/www\.youtube\.com\/watch\?v=/) });
    for (const trackId of row.trackIds ?? []) expect(tracks.map((track) => track._id)).toContain(trackId);
  }

  // Practice events never show in the real lists or as the live event.
  const real = await t.query(api.events.listOrganizationEvents, { paginationOpts: { numItems: 20, cursor: null } });
  expect(real.page.map((row) => row.slug)).toEqual(["devday"]);
  expect(await t.query(api.events.getLiveEvent, {})).toMatchObject({ slug: "devday" });
  expect(await practiceRows(t)).toEqual([expect.objectContaining({
    slug: created.slug, copiedFromName: "DevDay Exchange", isYours: true, ownerUserId: ACTOR_SUBJECT, phase: "submissions",
    tidiesAwayAt: event.updatedAt + 14 * 24 * 60 * 60 * 1000,
  })]);
  // The live event is untouched.
  expect(await t.run((ctx) => ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", liveId)).collect())).toHaveLength(1);
});

test("a blank demo night or hackathon starts empty, and bad counts are refused", async () => {
  const { t } = setupTest();
  const demo = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "demo" }, testSubmissions: 2, testJudges: 0 });
  expect(demo).toMatchObject({ judges: [], submissionCount: 2 });
  expect(await t.run((ctx) => ctx.db.get(demo.eventId))).toMatchObject({ name: "Practice demo night", eventType: "demo", practice: true });
  await expect(t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "demo" }, testSubmissions: 0, testJudges: 2 })).rejects.toThrow("no judges");
  await expect(t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 51, testJudges: 0 })).rejects.toThrow("0 to 50");
  await expect(t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 1.5, testJudges: 0 })).rejects.toThrow("whole number");
  await expect(t.action(api.practice.createPracticeEvent, { expectedOrganizationId: "org_other", start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 0, testJudges: 0 })).rejects.toThrow("organization changed");
  // A practice event cannot be copied.
  await expect(t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "copy", slug: demo.slug }, testSubmissions: 0, testJudges: 0 })).rejects.toThrow("Copy a real event");
  expect((await practiceRows(t)).map((row) => row.name)).toEqual(["Practice demo night"]);
});

test("the practice tools add submissions, score as test judges and skip the timer", async () => {
  const { t } = setupTest();
  await liveHackathon(t);
  const { slug, eventId } = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "copy", slug: "devday" }, testSubmissions: 2, testJudges: 2 });
  const added = await t.mutation(api.practice.addPracticeSubmissions, { slug, count: 3 });
  expect(added.submissionIds).toHaveLength(3);
  const emails = (await t.run((ctx) => ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect())).map((row) => row.normalizedEmail);
  expect(new Set(emails).size).toBe(5);
  expect((await t.query(api.changes.listRecentChanges, { slug })).changes[0]).toMatchObject({ summary: "added 3 test submissions", canUndo: true });

  await expect(t.mutation(api.practice.scoreAsTestJudges, { slug })).rejects.toThrow("Start judging first.");
  await expect(t.mutation(api.practice.skipTimerToLastSeconds, { slug })).rejects.toThrow("Start the timer first.");
  await t.mutation(api.judging.closeSubmissions, { slug });
  await expect(t.mutation(api.practice.addPracticeSubmissions, { slug, count: 1 })).rejects.toThrow("Submissions are closed");
  await t.mutation(api.judging.startAssignmentPreparation, { slug });
  while (!(await t.mutation(api.judging.prepareAssignmentBatch, { slug })).done);
  await t.mutation(api.judging.startJudging, { slug });

  const first = await t.mutation(api.practice.scoreAsTestJudges, { slug, limit: 3 });
  expect(first).toEqual({ scored: 3, remaining: 7 });
  const rest = await t.mutation(api.practice.scoreAsTestJudges, { slug });
  expect(rest).toEqual({ scored: 7, remaining: 0 });
  const reviews = await t.run((ctx) => ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect());
  expect(reviews).toHaveLength(10);
  for (const review of reviews) {
    expect(review.completed).toBe(true);
    for (const value of [review.innovation, review.execution, review.demoClarity]) {
      expect(Number.isInteger(value) && value! >= 3 && value! <= 9).toBe(true);
    }
  }

  const skipped = await t.mutation(api.practice.skipTimerToLastSeconds, { slug });
  expect(skipped).toMatchObject({ timer: "judging", remainingMs: 10_000 });
  expect(await t.query(api.judging.getJudgingTimer, { slug })).toMatchObject({ timerStatus: "running", remainingMs: 10_000 });
  await expect(t.mutation(api.practice.skipTimerToLastSeconds, { slug, timer: "stage" })).rejects.toThrow("Start the timer first.");
});

test("reset goes back to the start and keeps the test people, or removes them", async () => {
  const { t } = setupTest();
  const { slug, eventId } = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "hackathon" }, testSubmissions: 4, testJudges: 2 });
  await t.mutation(api.judging.closeSubmissions, { slug });
  await t.mutation(api.judging.startAssignmentPreparation, { slug });
  while (!(await t.mutation(api.judging.prepareAssignmentBatch, { slug })).done);
  await t.mutation(api.judging.startJudging, { slug });
  await t.mutation(api.practice.scoreAsTestJudges, { slug });

  expect(await t.mutation(api.practice.resetPracticeEvent, { slug })).toEqual({ phase: "submissions", keptSubmissions: 4 });
  const [event, submissions, reviews, links] = await t.run(async (ctx) => [
    await ctx.db.get(eventId),
    await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
    await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
    await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  ] as const);
  expect(event?.phase).toBe("submissions");
  expect([event?.submissionsClosedAt, event?.judgingStatus, event?.judgingTimerStatus]).toEqual([undefined, undefined, undefined]);
  expect(reviews).toHaveLength(0);
  expect(links).toHaveLength(2);
  expect(submissions.every((row) => row.status === "candidate" && row.roundOneAssignedJudges === undefined)).toBe(true);
  // Test people can be added again after a reset, with fresh emails.
  await t.mutation(api.practice.addPracticeSubmissions, { slug, count: 1 });
  expect((await t.query(api.changes.listRecentChanges, { slug })).changes[1]).toMatchObject({ summary: "reset the practice event to the start", canUndo: false });

  expect(await t.mutation(api.practice.resetPracticeEvent, { slug, keepSubmissions: false })).toEqual({ phase: "submissions", keptSubmissions: 0 });
  expect(await t.run((ctx) => ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect())).toHaveLength(0);
});

test("practice tools refuse real events and other organizations", async () => {
  const { root, t } = setupTest();
  await liveHackathon(t);
  for (const run of [
    () => t.mutation(api.practice.addPracticeSubmissions, { slug: "devday", count: 1 }),
    () => t.mutation(api.practice.scoreAsTestJudges, { slug: "devday" }),
    () => t.mutation(api.practice.skipTimerToLastSeconds, { slug: "devday" }),
    () => t.mutation(api.practice.resetPracticeEvent, { slug: "devday" }),
  ]) await expect(run()).rejects.toThrow("only works on a practice event");
  const { slug } = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "demo" }, testSubmissions: 0, testJudges: 0 });
  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  await expect(outsider.mutation(api.practice.resetPracticeEvent, { slug })).rejects.toThrow("Unauthorized");
  expect(await outsider.query(api.practice.listPracticeEvents, {})).toEqual([]);
});

test("old practice events are tidied away, and real events never are", async () => {
  const { t } = setupTest();
  const liveId = await liveHackathon(t);
  const { eventId } = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "copy", slug: "devday" }, testSubmissions: 3, testJudges: 2 });
  const fresh = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "blank", eventType: "demo" }, testSubmissions: 1, testJudges: 0 });
  // A renamed practice event leaves an old slug, and many change rows to delete a few at a time.
  await t.run(async (ctx) => {
    await ctx.db.insert("eventSlugAliases", { slug: "old-practice-slug", eventId });
    for (let index = 0; index < 45; index += 1) {
      await ctx.db.insert("eventChanges", { eventId, actor: "test|user_01DEMIAN", via: "app", kind: "test", summary: `change ${index}`, undo: "none", undoLabel: "Undo", docs: [], createdAt: Date.now() });
    }
  });
  // The live event is old too, but it is not a practice event.
  vi.setSystemTime(new Date("2026-11-14T18:00:00Z"));
  await t.run((ctx) => ctx.db.patch(fresh.eventId, { updatedAt: Date.now() }));
  await t.mutation(internal.practice.tidyPracticeEvents, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = await t.run(async (ctx) => ({
    event: await ctx.db.get(eventId),
    submissions: await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
    tracks: await ctx.db.query("eventTracks").withIndex("by_event_and_order", (q) => q.eq("eventId", eventId)).collect(),
    live: await ctx.db.get(liveId),
    fresh: await ctx.db.get(fresh.eventId),
    aliases: await ctx.db.query("eventSlugAliases").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
    changes: await ctx.db.query("eventChanges").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  }));
  expect(rows).toMatchObject({ event: null, submissions: [], tracks: [], aliases: [], changes: [] });
  expect(rows.live).not.toBeNull();
  expect(rows.fresh).not.toBeNull();
});

test("test projects use real public repositories and embeddable open-movie videos", async () => {
  const { t } = setupTest();
  await liveHackathon(t);
  const { eventId } = await t.action(api.practice.createPracticeEvent, { expectedOrganizationId: ORG, start: { kind: "copy", slug: "devday" }, testSubmissions: 6, testJudges: 0 });
  const rows = await t.run((ctx) => ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect());
  expect(rows).toHaveLength(6);
  const repos = new Map(PRACTICE_PROJECTS.map((project) => [project.githubUrl, project.description]));
  for (const row of rows) {
    // The description matches its repository, so the summary and the README agree.
    expect(repos.get(row.githubUrl!)).toBe(row.description);
    expect(PRACTICE_VIDEOS).toContain(row.videoUrl);
    expect(videoEmbedUrl(row.videoUrl)).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  }
  expect(new Set(rows.map((row) => row.videoUrl)).size).toBe(PRACTICE_VIDEOS.length);
});
