import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { ORG, setupTest, type TestClient } from "./behaviour.testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  vi.stubEnv("PREVIEW_SEED_ORGANIZATION_ID", ORG);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const seedRows = (t: TestClient) => t.run(async (ctx) => {
  const events = await ctx.db.query("events").collect();
  return Promise.all(events.map(async (event) => ({
    event,
    tracks: (await ctx.db.query("eventTracks").withIndex("by_event_and_order", (q) => q.eq("eventId", event._id)).collect()).map((row) => row.name),
    sponsors: (await ctx.db.query("eventSponsors").withIndex("by_event_and_order", (q) => q.eq("eventId", event._id)).collect()).map((row) => row.name),
    submissions: await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
    members: await ctx.db.query("teamMembers").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
    judges: await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
    reviews: await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
  })));
});

test("the seed makes a practice hackathon taking submissions and one in judging, with tracks, sponsors and judges", async () => {
  const { t } = setupTest();
  expect(await t.mutation(internal.previewSeed.seed, {})).toEqual({
    created: ["Preview hackathon, submissions open", "Preview hackathon, judging"],
    existing: [],
  });
  const [open, judging] = await seedRows(t);
  for (const row of [open, judging]) {
    expect(row.event).toMatchObject({ workosOrganizationId: ORG, eventType: "hackathon", practice: true, practiceAiSummaries: "sample" });
    expect(row.tracks).toEqual(["AI agents", "Developer tools", "Open"]);
    expect(row.sponsors).toEqual(["OpenAI", "Vercel"]);
  }
  expect(open.event).toMatchObject({ name: "Preview hackathon, submissions open", phase: "submissions" });
  expect(open.event.submissionsClosedAt).toBeUndefined();
  expect(open.submissions).toHaveLength(8);
  expect(open.judges.map((link) => link.judgeName)).toEqual(["Test judge A", "Test judge B", "Test judge C"]);

  expect(judging.event).toMatchObject({ name: "Preview hackathon, judging", phase: "judging", judgingStatus: "open", judgingTimerStatus: "paused" });
  expect(judging.submissions).toHaveLength(12);
  expect(judging.judges).toHaveLength(4);
  // Every project has two judges; 10 of the 24 reviews are done.
  expect(judging.submissions.every((row) => row.roundOneAssignedJudges?.length === 2)).toBe(true);
  expect(judging.reviews.filter((review) => review.completed)).toHaveLength(10);
});

test("the seeded events show for people signed in to that organisation, and nobody else", async () => {
  const { root, t } = setupTest();
  await t.mutation(internal.previewSeed.seed, {});
  expect((await t.query(api.practice.listPracticeEvents, {})).map((row) => [row.name, row.phase])).toEqual([
    ["Preview hackathon, judging", "judging"],
    ["Preview hackathon, submissions open", "submissions"],
  ]);
  const outsider = root.withIdentity({ subject: "user_02OUT", org_id: "org_other" });
  expect(await outsider.query(api.practice.listPracticeEvents, {})).toEqual([]);
});

test("test people use Resend's test inbox and are sent nothing", async () => {
  const { t } = setupTest();
  await t.mutation(internal.previewSeed.seed, {});
  const rows = await seedRows(t);
  const emails = rows.flatMap((row) => [...row.submissions.map((submission) => submission.email), ...row.members.map((member) => member.email)]);
  expect(emails.length).toBeGreaterThanOrEqual(20);
  for (const email of emails) expect(email).toMatch(/^delivered\+dq-test-\d+@resend\.dev$/);
  const scheduled = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((row) => row.name));
  expect(scheduled.filter((name) => name.includes("sendStatusLinkEmail"))).toEqual([]);
});

test("running the seed again changes nothing", async () => {
  const { t } = setupTest();
  await t.mutation(internal.previewSeed.seed, {});
  const before = await seedRows(t);
  expect(await t.mutation(internal.previewSeed.seed, {})).toEqual({
    created: [],
    existing: ["Preview hackathon, submissions open", "Preview hackathon, judging"],
  });
  expect(await seedRows(t)).toEqual(before);
});

test("without a WorkOS organisation id the seed stops with what to set", async () => {
  const { t } = setupTest();
  for (const value of [undefined, "", "  ", "Test", "org_bad id"]) {
    vi.stubEnv("PREVIEW_SEED_ORGANIZATION_ID", value);
    await expect(t.mutation(internal.previewSeed.seed, {})).rejects.toThrow("Set PREVIEW_SEED_ORGANIZATION_ID");
  }
  expect(await t.run((ctx) => ctx.db.query("events").collect())).toEqual([]);
});
