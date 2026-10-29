import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { rename } from "./eventSlugs";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./eventSlugs.ts": () => import("./eventSlugs"),
};
// Submitting queues an email; keep it queued so it never runs after a test ends.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const oldSlug = "test-hack-5-1db202";
const newSlug = "daytona-hacksprint-london-august-2026-1db202";
const organizationId = "org_outpost";

async function fixture() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity({ subject: "operator", org_id: organizationId });
  const { eventId } = await owner.mutation(api.events.createEvent, {
    name: "Daytona", slug: oldSlug, eventType: "hackathon",
    expectedOrganizationId: organizationId, meetUrl: "https://meet.google.com/example",
  });
  const args = { eventId, expectedSlug: oldSlug, expectedOrganizationId: organizationId, newSlug };
  return { t, owner, eventId, args };
}

test("rename defaults to a dry run, preserves every other event field, and is idempotent", async () => {
  const { t, eventId, args } = await fixture();
  const before = await t.run((ctx) => ctx.db.get(eventId));
  expect(await t.mutation(internal.eventSlugs.rename, args)).toEqual({ dryRun: true, eventId, previousSlug: oldSlug, slug: newSlug, kind: "change" });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("eventSlugAliases").collect())).toEqual([]);
  expect(await t.mutation(internal.eventSlugs.rename, { ...args, dryRun: false })).toMatchObject({ dryRun: false, kind: "change" });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual({ ...before, slug: newSlug });
  const aliases = await t.run((ctx) => ctx.db.query("eventSlugAliases").collect());
  expect(aliases).toMatchObject([{ slug: oldSlug, eventId }]);
  expect(await t.mutation(internal.eventSlugs.rename, { ...args, dryRun: false })).toMatchObject({ kind: "noop" });
  expect(await t.run((ctx) => ctx.db.query("eventSlugAliases").collect())).toEqual(aliases);
});

test("old and new slugs retain anonymous participant, judge, and presentation access without granting administration", async () => {
  const { t, owner, eventId, args } = await fixture();
  const submissionId = await t.run((ctx) => ctx.db.insert("submissions", {
    eventId, participantToken: "participant-link", name: "Participant", demoTitle: "Existing demo",
    description: "Existing description", phone: "+440000000000", status: "candidate",
    roundOneAssignedJudges: ["Alex", "Sam"], createdAt: 1, updatedAt: 1,
  }));
  await t.run((ctx) => ctx.db.patch(eventId, { roundOneJudges: ["Alex", "Sam"], judgingStatus: "open" }));
  await owner.mutation(api.judging.createJudgeAccess, { slug: oldSlug, judgeName: "Alex", capabilityToken: "judge-link" });
  const submissionBefore = await t.run((ctx) => ctx.db.get(submissionId));
  await t.mutation(internal.eventSlugs.rename, { ...args, dryRun: false });
  for (const slug of [oldSlug, newSlug]) {
    expect(await t.query(api.events.getEventMeta, { slug })).toMatchObject({ name: "Daytona", slug: newSlug });
    expect((await t.query(api.events.getStage, { slug })).event).toMatchObject({ name: "Daytona", slug: newSlug });
    expect(await t.query(api.events.getParticipantMeta, { slug, participantToken: "participant-link" })).toMatchObject({ event: { slug: newSlug }, submission: { demoTitle: "Existing demo" } });
    expect(await t.query(api.events.getParticipant, { slug, participantToken: "participant-link" })).toMatchObject({ submission: { demoTitle: "Existing demo" } });
    expect(await t.query(api.judging.getMyAssignments, { slug, capabilityToken: "judge-link" })).toMatchObject({ eventName: "Daytona", judgeName: "Alex", assignments: [{ id: submissionId }] });
    await expect(t.query(api.judging.getMyAssignments, { slug, capabilityToken: "invalid" })).rejects.toThrow("Unauthorized");
    expect(await owner.query(api.events.getAdminEventMeta, { slug })).toMatchObject({ slug: newSlug });
    expect(await owner.query(api.events.getOrganizationEventDetails, { slug })).toMatchObject({ slug: newSlug });
    await expect(t.query(api.events.getAdmin, { slug })).rejects.toThrow("Sign in");
    await expect(t.withIdentity({ subject: "other", org_id: "org_test" }).query(api.events.getAdmin, { slug })).rejects.toThrow("Unauthorized");
  }
  expect(await t.run((ctx) => ctx.db.get(submissionId))).toEqual(submissionBefore);
  await t.mutation(api.judging.saveReview, { slug: oldSlug, capabilityToken: "judge-link", submissionId, innovation: 7 });
  expect(await t.query(api.judging.getMyAssignments, { slug: newSlug, capabilityToken: "judge-link" })).toMatchObject({ assignments: [{ review: { innovation: 7 } }] });
});

test("submission forms remain account-free through an old slug, and creation cannot reuse it", async () => {
  const { t, owner, eventId, args } = await fixture();
  await t.run((ctx) => ctx.db.patch(eventId, { eventType: "demo" }));
  await t.mutation(internal.eventSlugs.rename, { ...args, dryRun: false });
  for (const slug of [oldSlug, newSlug]) {
    const { submissionId } = (await t.mutation(api.events.submitDemo, {
      slug, participantToken: `participant-${slug}`, clientId: "test-browser-slugs-0001", name: "Participant", demoTitle: `Demo ${slug}`,
      description: "A working demonstration", phone: "+447700900123", queueOrder: 1,
    })) as { submissionId: Id<"submissions"> };
    expect(await t.run((ctx) => ctx.db.get(submissionId))).toMatchObject({ eventId, demoTitle: `Demo ${slug}` });
  }
  await expect(owner.mutation(api.events.createEvent, {
    name: "Hijack", slug: oldSlug, eventType: "demo", expectedOrganizationId: organizationId,
    meetUrl: "https://meet.google.com/example",
  })).rejects.toThrow("already exists");
});

test("wrong identity, ownership, invalid slugs, and reserved destinations leave data unchanged", async () => {
  const { t, eventId, args } = await fixture();
  const otherId = await t.run((ctx) => ctx.db.insert("events", {
    name: "Other", slug: "reserved", workosOrganizationId: organizationId,
    meetUrl: "https://meet.google.com/example", queuePublished: false, createdAt: 1, updatedAt: 1,
  }));
  await t.run((ctx) => ctx.db.insert("eventSlugAliases", { slug: "reserved-alias", eventId: otherId }));
  const before = await t.run((ctx) => ctx.db.get(eventId));
  const aliasesBefore = await t.run((ctx) => ctx.db.query("eventSlugAliases").collect());
  for (const change of [
    { expectedSlug: "wrong" }, { expectedOrganizationId: "org_test" },
    { newSlug: "../invalid" }, { newSlug: "a".repeat(201) }, { newSlug: oldSlug },
    { newSlug: "reserved" }, { newSlug: "reserved-alias" },
  ]) {
    await expect(t.mutation(internal.eventSlugs.rename, { ...args, ...change, dryRun: false })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("eventSlugAliases").collect())).toEqual(aliasesBefore);
  }
  expect(rename).toHaveProperty("isInternal", true);
  expect(rename).not.toHaveProperty("isPublic", true);
});

test("later renames keep earlier aliases and repeated calls still enforce ownership", async () => {
  const { t, eventId, args } = await fixture();
  await t.mutation(internal.eventSlugs.rename, { ...args, dryRun: false });
  await t.mutation(internal.eventSlugs.rename, {
    ...args, expectedSlug: newSlug, newSlug: "daytona-next", dryRun: false,
  });
  for (const slug of [oldSlug, newSlug, "daytona-next"]) {
    expect(await t.query(api.events.getEventMeta, { slug })).toMatchObject({ name: "Daytona", slug: "daytona-next" });
  }
  await t.run((ctx) => ctx.db.patch(eventId, { workosOrganizationId: "org_test" }));
  await expect(t.mutation(internal.eventSlugs.rename, {
    ...args, expectedSlug: newSlug, newSlug: "daytona-next", dryRun: false,
  })).rejects.toThrow("ownership changed");
});
