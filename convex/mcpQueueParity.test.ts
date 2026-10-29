import { convexTest } from "convex-test";
import type { DefaultFunctionArgs, FunctionReference } from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { OrganizationPrincipal } from "./organizationAuth";
import { adminToolSchema, convexMcpSchema } from "./mcpSchema";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./judging.ts": () => import("./judging"),
  "./mcpAdmin.ts": () => import("./mcpAdmin"),
};
const now = 1_800_000_000_000;
const identity = {
  subject: "operator", issuer: "https://identity.example",
  tokenIdentifier: "https://identity.example|operator", org_id: "org_parity",
};
const principal: OrganizationPrincipal = { organizationId: identity.org_id, actor: identity.tokenIdentifier };
const slug = "parity-event";
const fields = {
  name: "Presenter", demoTitle: "Working demo", description: "A useful live demo",
  phone: "+447700900123", email: "presenter@example.com", category: "other",
};

beforeEach(() => { vi.useFakeTimers({ now }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture(eventType: "demo" | "hackathon" = "demo", t = convexTest(schema, modules), suffix = "") {
  const eventSlug = `${slug}${suffix}`;
  const browser = t.withIdentity(identity);
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "Parity event", slug: eventSlug, eventType, workosOrganizationId: principal.organizationId,
    meetUrl: "https://meet.example/parity", queuePublished: false, createdAt: 1, updatedAt: 1,
  }));
  const foreignEventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "Foreign event", slug: `foreign-event${suffix}`, eventType,
    workosOrganizationId: "org_foreign", meetUrl: "https://meet.example/foreign",
    queuePublished: false, createdAt: 1, updatedAt: 1,
  }));
  const submissions = await t.run(async (ctx) => {
    const rows: { label: string; status: Doc<"submissions">["status"]; queueOrder?: number }[] = [
      { label: "First", status: "queued", queueOrder: 1 },
      { label: "Second", status: "queued", queueOrder: 2 },
      { label: "Pool", status: "candidate" },
      { label: "Hidden", status: "hidden" },
      { label: "Done", status: "done" },
      { label: "Absent", status: "no_show" },
      { label: "Withdrawn", status: "withdrawn" },
    ];
    const ids = [];
    for (const row of rows) ids.push(await ctx.db.insert("submissions", {
      ...fields, eventId, name: row.label, demoTitle: row.label, email: `${row.label.toLowerCase()}@example.com`,
      participantToken: `private-${row.label}`, status: row.status,
      queueOrder: row.queueOrder, createdAt: 1, updatedAt: 1,
    }));
    return ids;
  });
  const [first, second, pool, hidden, done, absent, withdrawn] = submissions;
  if (!first || !second || !pool || !hidden || !done || !absent || !withdrawn) throw new Error("Missing fixture submission");
  const foreign = await t.run((ctx) => ctx.db.insert("submissions", {
    ...fields, eventId: foreignEventId, participantToken: "foreign-secret",
    name: "Foreign", demoTitle: "Foreign", status: "candidate", createdAt: 1, updatedAt: 1,
  }));
  await t.run(async (ctx) => {
    await ctx.db.insert("eventSlugAliases", { slug: `old-parity${suffix}`, eventId });
    await ctx.db.insert("eventSlugAliases", { slug: `old-foreign${suffix}`, eventId: foreignEventId });
    await ctx.db.insert("teamMembers", {
      eventId, submissionId: first, name: "Team mate", email: "member@example.com",
      whatsappPhone: "+447700900124", createdAt: 1,
    });
  });
  return { t, browser, slug: eventSlug, eventId, foreignEventId, first, second, pool, hidden, done, absent, withdrawn, foreign };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Pair = { browser: Fixture; mcp: Fixture };
async function pair(eventType: "demo" | "hackathon" = "demo"): Promise<Pair> {
  const t = convexTest(schema, modules);
  return { browser: await fixture(eventType, t), mcp: await fixture(eventType, t, "-mcp") };
}

async function stored(f: Fixture) {
  return f.t.run(async (ctx) => ({
    events: (await ctx.db.query("events").collect()).filter((row) => row._id === f.eventId || row._id === f.foreignEventId),
    submissions: (await ctx.db.query("submissions").collect()).filter((row) => row.eventId === f.eventId || row.eventId === f.foreignEventId),
    members: (await ctx.db.query("teamMembers").collect()).filter((row) => row.eventId === f.eventId),
    audit: (await ctx.db.query("auditLog").collect()).filter((row) => row.eventId === f.eventId),
  }));
}

async function normalized(f: Fixture, value: unknown) {
  const state = await stored(f);
  const ids = new Map<string, string>([
    [f.eventId, "event:own"], [f.foreignEventId, "event:foreign"],
    ...state.events.map((row): [string, string] => [row.slug, row._id === f.eventId ? slug : "foreign-event"]),
    [f.first, "submission:First"], [f.second, "submission:Second"],
    [f.pool, "submission:Pool"], [f.hidden, "submission:Hidden"],
    [f.done, "submission:Done"], [f.absent, "submission:Absent"], [f.withdrawn, "submission:Withdrawn"],
    ...state.submissions.map((row): [string, string] => [row._id, `submission:${row.demoTitle}`]),
  ]);
  function visit(value: unknown): unknown {
    if (typeof value === "string") return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !["_id", "_creationTime", "participantToken"].includes(key)).map(([key, item]) => [key, visit(item)]));
  }
  return visit(value);
}

async function sameState(p: Pair) {
  expect(await normalized(p.mcp, await stored(p.mcp))).toEqual(await normalized(p.browser, await stored(p.browser)));
  for (const f of [p.browser, p.mcp]) {
    const audit = (await stored(f)).audit;
    expect(audit.every((row) => row.actor === principal.actor)).toBe(true);
  }
}

async function apply<A extends DefaultFunctionArgs, R>(
  p: Pair,
  browser: FunctionReference<"mutation", "public", A & { slug: string }, R>,
  mcp: FunctionReference<"mutation", "internal", { principal: OrganizationPrincipal; input: A & { slug: string } }, R>,
  input: (f: Fixture) => A & { slug: string },
) {
  const publicReference: FunctionReference<"mutation", "public", DefaultFunctionArgs, R> = browser;
  const publicResult = await p.browser.browser.mutation(publicReference, { ...input(p.browser), slug: p.browser.slug });
  const privateResult = await p.mcp.t.mutation(mcp, { principal, input: { ...input(p.mcp), slug: p.mcp.slug } });
  expect(await normalized(p.mcp, privateResult)).toEqual(await normalized(p.browser, publicResult));
  await sameState(p);
}

test("stage switches, publication and visibility persist the browser behavior and actor", async () => {
  const p = await pair();
  for (const f of [p.browser, p.mcp]) {
    const operation = f === p.browser
      ? f.browser.mutation(api.events.setStageMeetLinkVisible, { slug, visible: true })
      : f.t.mutation(internal.mcpAdmin.setStageMeetLinkVisible, { principal, input: { slug: f.slug, visible: true } });
    await expect(operation).rejects.toThrow("Publish the queue");
  }
  await sameState(p);
  await apply(p, api.events.publishQueue, internal.mcpAdmin.publishQueue, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ queuePublished: true, stageScreenMode: "demo" });
  for (const mode of ["qr", "demo"] satisfies ("qr" | "demo")[]) {
    await apply(p, api.events.setStageScreenMode, internal.mcpAdmin.setStageScreenMode, () => ({ slug, mode }));
  }
  for (const visible of [true, false]) {
    await apply(p, api.events.setSubmissionCountVisible, internal.mcpAdmin.setSubmissionCountVisible, () => ({ slug, visible }));
    await apply(p, api.events.setStageMeetLinkVisible, internal.mcpAdmin.setStageMeetLinkVisible, () => ({ slug, visible }));
    await apply(p, api.events.setStageTimerVisible, internal.mcpAdmin.setStageTimerVisible, () => ({ slug, visible }));
    await apply(p, api.events.setDemoTimerVisible, internal.mcpAdmin.setDemoTimerVisible, () => ({ slug, visible }));
  }
  const state = await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId));
  expect(state).toMatchObject({ showSubmissionCountOnStage: false, showMeetLinkOnStage: false, showStageTimerOnStage: false, showDemoTimerOnStage: false });
});

test("stage timer duration, start, adjustment, pause, resume and reset match exactly", async () => {
  const p = await pair();
  await apply(p, api.events.setStageTimerDuration, internal.mcpAdmin.setStageTimerDuration, () => ({ slug, durationMs: 60_000 }));
  await apply(p, api.events.startStageTimer, internal.mcpAdmin.startStageTimer, () => ({ slug }));
  vi.setSystemTime(now + 10_000);
  await apply(p, api.events.setStageTimerDuration, internal.mcpAdmin.setStageTimerDuration, () => ({ slug, durationMs: 90_000 }));
  await apply(p, api.events.adjustStageTimer, internal.mcpAdmin.adjustStageTimer, () => ({ slug, deltaMs: -100_000 }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ stageTimerStatus: "running", stageTimerRemainingMs: -20_000, stageTimerEndsAt: now - 10_000 });
  await apply(p, api.events.pauseStageTimer, internal.mcpAdmin.pauseStageTimer, () => ({ slug }));
  await apply(p, api.events.adjustStageTimer, internal.mcpAdmin.adjustStageTimer, () => ({ slug, deltaMs: 50_000 }));
  await apply(p, api.events.startStageTimer, internal.mcpAdmin.startStageTimer, () => ({ slug, durationMs: 120_000 }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ stageTimerRemainingMs: 30_000, stageTimerDurationMs: 120_000 });
  await apply(p, api.events.resetStageTimer, internal.mcpAdmin.resetStageTimer, () => ({ slug, durationMs: 45_000 }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ stageTimerStatus: "idle", stageTimerRemainingMs: 60_000, showStageTimerOnStage: false });
  await apply(p, api.events.resetStageTimer, internal.mcpAdmin.resetStageTimer, () => ({ slug }));
});

test("demo timer keeps paused overtime, resumes and preserves the configured duration", async () => {
  const p = await pair();
  await apply(p, api.events.setDemoTimerDuration, internal.mcpAdmin.setDemoTimerDuration, () => ({ slug, durationMs: 60_000 }));
  await apply(p, api.events.startDemoTimer, internal.mcpAdmin.startDemoTimer, () => ({ slug }));
  vi.setSystemTime(now + 70_000);
  await apply(p, api.events.pauseDemoTimer, internal.mcpAdmin.pauseDemoTimer, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ demoTimerStatus: "paused", demoTimerRemainingMs: -10_000 });
  await apply(p, api.events.adjustDemoTimer, internal.mcpAdmin.adjustDemoTimer, () => ({ slug, deltaMs: -5_000 }));
  await apply(p, api.events.setDemoTimerDuration, internal.mcpAdmin.setDemoTimerDuration, () => ({ slug, durationMs: 90_000 }));
  await apply(p, api.events.startDemoTimer, internal.mcpAdmin.startDemoTimer, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ demoTimerStatus: "running", demoTimerDurationMs: 90_000, demoTimerRemainingMs: -15_000, demoTimerEndsAt: now + 55_000 });
  await apply(p, api.events.adjustDemoTimer, internal.mcpAdmin.adjustDemoTimer, () => ({ slug, deltaMs: 20_000 }));
});

test("advance, restore, skip and no-show operate on the published positional lineup", async () => {
  const p = await pair();
  for (const operation of [
    () => apply(p, api.events.pickNext, internal.mcpAdmin.pickNext, () => ({ slug })),
    () => apply(p, api.events.skipCurrent, internal.mcpAdmin.skipCurrent, () => ({ slug })),
    () => apply(p, api.events.markNoShow, internal.mcpAdmin.markNoShow, () => ({ slug })),
  ]) await operation();
  expect((await stored(p.mcp)).audit).toEqual([]);
  await apply(p, api.events.publishQueue, internal.mcpAdmin.publishQueue, () => ({ slug }));
  await apply(p, api.events.startDemoTimer, internal.mcpAdmin.startDemoTimer, () => ({ slug }));
  vi.setSystemTime(now + 15_000);
  await apply(p, api.events.pickNext, internal.mcpAdmin.pickNext, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.first))).toMatchObject({ status: "done" });
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ demoTimerStatus: "idle", lastAdvanceSnapshot: { currentSubmissionId: p.mcp.first, demoTimerRemainingMs: 105_000 } });
  await apply(p, api.events.restorePreviousPresenter, internal.mcpAdmin.restorePreviousPresenter, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ demoTimerStatus: "paused", demoTimerRemainingMs: 105_000 });
  await apply(p, api.events.skipCurrent, internal.mcpAdmin.skipCurrent, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.first))).toMatchObject({ queueOrder: 3 });
  await apply(p, api.events.markNoShow, internal.mcpAdmin.markNoShow, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.second))).toMatchObject({ status: "no_show" });
  await apply(p, api.events.restorePreviousPresenter, internal.mcpAdmin.restorePreviousPresenter, () => ({ slug }));
});

test("pool, hiding, restoring, partial reordering and lineup target preserve browser rules", async () => {
  const p = await pair();
  await apply(p, api.events.moveToPool, internal.mcpAdmin.moveToPool, (f) => ({ slug, submissionId: f.first }));
  await apply(p, api.events.hideSubmission, internal.mcpAdmin.hideSubmission, (f) => ({ slug, submissionId: f.pool }));
  await apply(p, api.events.restoreSubmission, internal.mcpAdmin.restoreSubmission, (f) => ({ slug, submissionId: f.pool }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.pool))).toMatchObject({ status: "candidate" });
  await apply(p, api.events.reorderLineup, internal.mcpAdmin.reorderLineup, (f) => ({ slug, orderedIds: [f.hidden, f.pool, f.done, f.absent, f.withdrawn, f.foreign] }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.second))).toMatchObject({ status: "queued", queueOrder: 2 });
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.hidden))).toMatchObject({ status: "queued", queueOrder: 1 });
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.foreign))).toMatchObject({ status: "candidate" });
  for (const target of [-5, 2.4, 100]) {
    await apply(p, api.events.setLineupTarget, internal.mcpAdmin.setLineupTarget, () => ({ slug, target }));
    expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ lineupTarget: Math.max(0, Math.min(99, Math.round(target))) });
  }
});

test("shuffle draws only eligible demos up to the target and keeps an ordered lineup", async () => {
  const p = await pair();
  vi.spyOn(Math, "random").mockReturnValue(0.25);
  await apply(p, api.events.setLineupTarget, internal.mcpAdmin.setLineupTarget, () => ({ slug, target: 2 }));
  await apply(p, api.events.shuffleLineup, internal.mcpAdmin.shuffleLineup, () => ({ slug }));
  const rows = (await stored(p.mcp)).submissions.filter((row) => row.eventId === p.mcp.eventId);
  expect(rows.filter((row) => row.status === "queued").map((row) => row.queueOrder).sort()).toEqual([1, 2]);
  expect(rows.find((row) => row._id === p.mcp.hidden)?.status).toBe("hidden");
  expect(rows.find((row) => row._id === p.mcp.done)?.status).toBe("done");
  expect(rows.filter((row) => row.status === "candidate")).toHaveLength(1);
});

test("adding and editing demos generates a private capability and matches normalized browser data", async () => {
  const p = await pair();
  for (const list of ["lineup", "pool"] satisfies ("lineup" | "pool")[]) {
    const input = { slug, ...fields, name: "  New presenter  ", demoTitle: `Added ${list}`, email: `added-${list}@example.com`, queueOrder: 9, list };
    await p.browser.browser.mutation(api.events.adminAddSubmission, { ...input, participantToken: `browser-${list}` });
    const result = await p.mcp.t.mutation(internal.mcpAdmin.addSubmission, { principal, input: { ...input, slug: p.mcp.slug } });
    const row = await p.mcp.t.run((ctx) => ctx.db.get(result.submissionId));
    expect(row).toMatchObject({ name: "New presenter", status: list === "pool" ? "candidate" : "queued", participantToken: expect.any(String) });
    expect(row?.participantToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).not.toHaveProperty("participantToken");
    await sameState(p);
  }
  await apply(p, api.events.updateSubmission, internal.mcpAdmin.updateSubmission, (f) => ({ slug, submissionId: f.first, ...fields, name: "Updated presenter", demoTitle: "Updated title" }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.first))).toMatchObject({ name: "Updated presenter", demoTitle: "Updated title" });
  for (const f of [p.browser, p.mcp]) {
    const input = { slug: f.slug, submissionId: f.first, ...fields, demoTitle: "x".repeat(65) };
    await expect(f === p.browser ? f.browser.mutation(api.events.updateSubmission, input) : f.t.mutation(internal.mcpAdmin.updateSubmission, { principal, input })).rejects.toThrow();
  }
  await sameState(p);
});

test.each(["demo", "hackathon"] satisfies ("demo" | "hackathon")[])("test batches support %s fixtures, nested team members and atomic validation", async (eventType) => {
  const p = await pair(eventType);
  const submissions = [1, 2].map((index) => ({ ...fields, demoTitle: `Seeded ${index}`, email: `seeded-${index}@example.com`, teamName: `Team ${index}`, teamMembers: ["One", "Two"], githubUrl: "https://github.com/example/project" }));
  await p.browser.browser.mutation(api.events.adminAddTestSubmissions, { slug, submissions: submissions.map((s, index) => ({ ...s, participantToken: `batch-${index}` })) });
  const result = await p.mcp.t.mutation(internal.mcpAdmin.addTestSubmissions, { principal, input: { slug: p.mcp.slug, submissions } });
  expect(result.submissionIds).toHaveLength(2);
  await sameState(p);
  const seeded = (await stored(p.mcp)).submissions.filter((s) => result.submissionIds.includes(s._id));
  expect(new Set(seeded.map((s) => s.participantToken)).size).toBe(2);
  expect(seeded.every((s) => s.status === "candidate")).toBe(true);
  expect((await stored(p.mcp)).members).toHaveLength(eventType === "hackathon" ? 5 : 1);
  const before = await stored(p.mcp);
  for (const submissions of [[], Array.from({ length: 26 }, () => fields), [fields, { ...fields, demoTitle: "x".repeat(65) }]]) {
    await expect(p.mcp.t.mutation(internal.mcpAdmin.addTestSubmissions, { principal, input: { slug: p.mcp.slug, submissions } })).rejects.toThrow();
    expect(await stored(p.mcp)).toEqual(before);
  }
});

test("private admin reads preserve all six groups and explicitly separate contacts", async () => {
  const f = await fixture();
  const browser = await f.browser.query(api.events.getAdmin, { slug: "old-parity" });
  const admin = await f.t.query(internal.mcpAdmin.getEventAdmin, { principal, input: { slug: "old-parity" } });
  expect(admin.event).toEqual(browser.event);
  for (const group of ["lineup", "pool", "hidden", "completed", "noShows", "withdrawn"] satisfies (keyof Omit<typeof admin, "event">)[]) {
    const privateKeys = ["phone", "email", "twitter", "linkedin", "githubProfile", "teamMemberContacts", "participantToken"];
    expect(admin[group]).toEqual(browser[group].map((submission) => Object.fromEntries(Object.entries(submission).filter(([key]) => !privateKeys.includes(key)))));
    for (const submission of admin[group]) {
      for (const key of privateKeys) expect(submission).not.toHaveProperty(key);
    }
  }
  expect(admin.lineup[0]).toMatchObject({ teamMembers: ["Team mate"] });
  const contacts = await f.t.query(internal.mcpAdmin.getSubmissionContacts, { principal, input: { slug, submissionId: f.first } });
  expect(contacts).toMatchObject({ id: f.first, phone: fields.phone, email: "first@example.com", teamMemberContacts: [{ name: "Team mate", email: "member@example.com", whatsappPhone: "+447700900124" }] });
  expect(contacts).not.toHaveProperty("participantToken");
  expect(await f.t.query(internal.mcpAdmin.getEventOverview, { principal, input: { slug } })).toEqual(await f.browser.query(api.events.getOrganizationEventDetails, { slug }));
});

test("judge roster and asynchronous sheet requests preserve event state and reject unavailable sync", async () => {
  const p = await pair("hackathon");
  await apply(p, api.events.saveRoundOneJudges, internal.mcpAdmin.saveRoundOneJudges, () => ({ slug, judges: ["Alex", "Sam"] }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ roundOneJudges: ["Alex", "Sam"] });
  for (const f of [p.browser, p.mcp]) {
    await expect(f === p.browser ? f.browser.mutation(api.events.requestJudgingSheetSync, { slug: f.slug }) : f.t.mutation(internal.mcpAdmin.requestJudgingSheetSync, { principal, input: { slug: f.slug } })).rejects.toThrow("Create the judging sheet");
    await f.t.run((ctx) => ctx.db.patch(f.eventId, { judgingSheetId: "isolated-sheet", judgingSheetSyncRevision: 3, judgingSheetSyncError: "old error" }));
  }
  await apply(p, api.events.requestJudgingSheetSync, internal.mcpAdmin.requestJudgingSheetSync, () => ({ slug }));
  expect(await p.mcp.t.run((ctx) => ctx.db.get(p.mcp.eventId))).toMatchObject({ judgingSheetSyncRevision: 4 });
  const jobs = await p.mcp.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(jobs.filter((job) => job.args[0]?.eventId === p.mcp.eventId)).toMatchObject([{ name: "googleSheets:syncJudgingSheet", args: [{ eventId: p.mcp.eventId, revision: 4 }] }]);
});

test.each(["clear", "change"])("%s requires matching confirmation and deletes only the isolated event's submissions, teams and files", async (operation) => {
  const p = await pair();
  const files = [];
  for (const f of [p.browser, p.mcp]) {
    const screenshotId = await f.t.run((ctx) => ctx.storage.store(new Blob(["fixture screenshot"])));
    const videoStorageId = await f.t.run((ctx) => ctx.storage.store(new Blob(["fixture video"])));
    files.push({ f, screenshotId, videoStorageId });
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.first, { screenshotId, videoStorageId });
      await ctx.db.patch(f.eventId, { queuePublished: true, lineupTarget: 3, judgingSheetId: "retained-external-sheet", stageTimerStatus: "running", stageTimerEndsAt: now + 20_000 });
    });
  }
  const before = await stored(p.mcp);
  if (operation === "clear") {
    await expect(p.mcp.t.mutation(internal.mcpAdmin.clearQueue, { principal, input: { slug: p.mcp.slug, confirmation: { action: "clear_queue", slug: "different" } } })).rejects.toThrow("Confirmation must match");
    expect(await stored(p.mcp)).toEqual(before);
    await p.browser.browser.mutation(api.events.clearQueue, { slug });
    await p.mcp.t.mutation(internal.mcpAdmin.clearQueue, { principal, input: { slug: p.mcp.slug, confirmation: { action: "clear_queue", slug: p.mcp.slug } } });
  } else {
    const input = { slug, eventType: "hackathon", confirmReset: true } satisfies { slug: string; eventType: "hackathon"; confirmReset: boolean };
    await expect(p.mcp.t.mutation(internal.mcpAdmin.changeEventType, { principal, input: { ...input, slug: p.mcp.slug, confirmation: { action: "change_event_type", slug: p.mcp.slug, eventType: "demo" } } })).rejects.toThrow("Confirmation must match");
    await expect(p.mcp.t.mutation(internal.mcpAdmin.changeEventType, { principal, input: { ...input, slug: p.mcp.slug, confirmReset: false, confirmation: { action: "change_event_type", slug: p.mcp.slug, eventType: "hackathon" } } })).rejects.toThrow("permanently delete");
    expect(await stored(p.mcp)).toEqual(before);
    await p.browser.browser.mutation(api.events.changeEventType, input);
    await p.mcp.t.mutation(internal.mcpAdmin.changeEventType, { principal, input: { ...input, slug: p.mcp.slug, confirmation: { action: "change_event_type", slug: p.mcp.slug, eventType: "hackathon" } } });
  }
  await sameState(p);
  for (const { f, screenshotId, videoStorageId } of files) {
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(screenshotId)) === null)).toBe(true);
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(videoStorageId)) === null)).toBe(true);
    expect(await f.t.run((ctx) => ctx.db.get(f.foreign))).toMatchObject({ name: "Foreign" });
    expect((await stored(f)).members).toEqual([]);
    const event = await f.t.run((ctx) => ctx.db.get(f.eventId));
    expect(event).toMatchObject({ queuePublished: false, stageScreenMode: "qr", stageTimerStatus: "idle", demoTimerStatus: "idle" });
    expect(event).not.toHaveProperty("judgingSheetId");
    expect(event).not.toHaveProperty("lineupTarget");
  }
});

test("organization scope applies to aliases, private reads and writes, and foreign submission IDs", async () => {
  const f = await fixture();
  const before = await stored(f);
  for (const slug of ["foreign-event", "old-foreign", "missing"]) {
    await expect(f.t.query(internal.mcpAdmin.getEventAdmin, { principal, input: { slug } })).rejects.toThrow("Unauthorized");
    await expect(f.t.mutation(internal.mcpAdmin.publishQueue, { principal, input: { slug } })).rejects.toThrow("Unauthorized");
    expect(await f.t.query(internal.mcpAdmin.getEventOverview, { principal, input: { slug } })).toBeNull();
  }
  await expect(f.t.query(internal.mcpAdmin.getEventAdmin, { principal: { ...principal, organizationId: "org_foreign" }, input: { slug: "old-parity" } })).rejects.toThrow("Unauthorized");
  for (const reference of [internal.mcpAdmin.hideSubmission, internal.mcpAdmin.restoreSubmission, internal.mcpAdmin.moveToPool]) {
    await expect(f.t.mutation(reference, { principal, input: { slug, submissionId: f.foreign } })).rejects.toThrow("Submission not found");
  }
  await expect(f.t.mutation(internal.mcpAdmin.updateSubmission, { principal, input: { slug, submissionId: f.foreign, ...fields } })).rejects.toThrow("Submission not found");
  await expect(f.t.query(internal.mcpAdmin.getSubmissionContacts, { principal, input: { slug, submissionId: f.foreign } })).rejects.toThrow("Submission not found");
  expect(await stored(f)).toEqual(before);
  await f.t.mutation(internal.mcpAdmin.publishQueue, { principal, input: { slug: "old-parity" } });
  expect(await f.t.run((ctx) => ctx.db.get(f.eventId))).toMatchObject({ queuePublished: true });
});

test("every queue, submission and timer write rejects a foreign organization before changing data", async () => {
  const f = await fixture("hackathon");
  const principal = { organizationId: "org_foreign", actor: "foreign-actor" };
  const input = { slug: "old-parity" };
  const operations = [
    () => f.t.mutation(internal.mcpAdmin.addSubmission, { principal, input: { ...input, ...fields, queueOrder: 1 } }),
    () => f.t.mutation(internal.mcpAdmin.addTestSubmissions, { principal, input: { ...input, submissions: [fields] } }),
    () => f.t.mutation(internal.mcpAdmin.saveRoundOneJudges, { principal, input: { ...input, judges: ["Alex", "Sam"] } }),
    () => f.t.mutation(internal.mcpAdmin.changeEventType, { principal, input: { ...input, eventType: "demo", confirmReset: true, confirmation: { action: "change_event_type", slug: input.slug, eventType: "demo" } } }),
    () => f.t.mutation(internal.mcpAdmin.requestJudgingSheetSync, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.updateSubmission, { principal, input: { ...input, ...fields, submissionId: f.first } }),
    () => f.t.mutation(internal.mcpAdmin.publishQueue, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.setStageScreenMode, { principal, input: { ...input, mode: "demo" } }),
    () => f.t.mutation(internal.mcpAdmin.setSubmissionCountVisible, { principal, input: { ...input, visible: true } }),
    () => f.t.mutation(internal.mcpAdmin.setStageMeetLinkVisible, { principal, input: { ...input, visible: true } }),
    () => f.t.mutation(internal.mcpAdmin.setStageTimerVisible, { principal, input: { ...input, visible: true } }),
    () => f.t.mutation(internal.mcpAdmin.setStageTimerDuration, { principal, input: { ...input, durationMs: 60_000 } }),
    () => f.t.mutation(internal.mcpAdmin.startStageTimer, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.setDemoTimerVisible, { principal, input: { ...input, visible: true } }),
    () => f.t.mutation(internal.mcpAdmin.setDemoTimerDuration, { principal, input: { ...input, durationMs: 60_000 } }),
    () => f.t.mutation(internal.mcpAdmin.startDemoTimer, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.pauseDemoTimer, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.adjustDemoTimer, { principal, input: { ...input, deltaMs: 10_000 } }),
    () => f.t.mutation(internal.mcpAdmin.pauseStageTimer, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.resetStageTimer, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.adjustStageTimer, { principal, input: { ...input, deltaMs: 10_000 } }),
    () => f.t.mutation(internal.mcpAdmin.hideSubmission, { principal, input: { ...input, submissionId: f.first } }),
    () => f.t.mutation(internal.mcpAdmin.restoreSubmission, { principal, input: { ...input, submissionId: f.first } }),
    () => f.t.mutation(internal.mcpAdmin.reorderLineup, { principal, input: { ...input, orderedIds: [f.first] } }),
    () => f.t.mutation(internal.mcpAdmin.shuffleLineup, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.moveToPool, { principal, input: { ...input, submissionId: f.first } }),
    () => f.t.mutation(internal.mcpAdmin.setLineupTarget, { principal, input: { ...input, target: 1 } }),
    () => f.t.mutation(internal.mcpAdmin.markNoShow, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.pickNext, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.restorePreviousPresenter, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.skipCurrent, { principal, input }),
    () => f.t.mutation(internal.mcpAdmin.clearQueue, { principal, input: { ...input, confirmation: { action: "clear_queue", slug: input.slug } } }),
  ];
  const before = await stored(f);
  for (const operation of operations) {
    await expect(operation()).rejects.toThrow("Unauthorized");
    expect(await stored(f)).toEqual(before);
  }
});

test("transport strings still pass through table-specific Convex ID validation", async () => {
  const f = await fixture();
  const transport = convexMcpSchema(v.object({ slug: v.string(), submissionId: v.string() }))["~standard"];
  for (const submissionId of ["not-an-id", f.eventId]) {
    const parsed = await transport.validate({ slug, submissionId });
    if (parsed.issues) throw new Error("Transport rejected a nonempty ID string before Convex validation");
    await expect(f.t.mutation(internal.mcpAdmin.hideSubmission, { principal, input: parsed.value })).rejects.toThrow();
    await expect(f.t.mutation(internal.mcpAdmin.reorderLineup, { principal, input: { slug, orderedIds: [submissionId] } })).rejects.toThrow();
  }
  expect(await f.t.run((ctx) => ctx.db.get(f.first))).toMatchObject({ status: "queued" });
});

test("transport schemas validate nested arrays, optional unions, false and strict object fields", async () => {
  const validator = v.object({
    slug: v.string(), visible: v.boolean(),
    options: v.optional(v.union(v.literal("demo"), v.literal("qr"))),
    teams: v.array(v.object({ names: v.array(v.string()), duration: v.number() })),
  });
  const transport = convexMcpSchema(validator)["~standard"];
  const value = { slug, visible: false, teams: [{ names: ["Alex", "Sam"], duration: 15 }] };
  expect(await transport.validate(value)).toEqual({ value });
  for (const invalid of [
    { ...value, extra: true }, { ...value, visible: "false" }, { ...value, slug: 42 },
    { ...value, options: "other" }, { ...value, teams: [{ names: [1], duration: 15 }] },
    { ...value, teams: [{ names: [], duration: Infinity }] },
    { ...value, teams: [{ names: [], duration: NaN }] },
    { ...value, teams: [{ names: [], duration: 1, extra: true }] },
  ]) expect(await transport.validate(invalid)).toHaveProperty("issues");
  const selected = adminToolSchema(validator)["~standard"];
  expect(await selected.validate({ organizationId: "org_parity", ...value })).toEqual({ value: { organizationId: "org_parity", input: value } });
  expect(await selected.validate({ organizationId: "invalid", ...value })).toHaveProperty("issues");
  expect(() => convexMcpSchema(v.bytes())).toThrow("Unsupported MCP validator");
});
