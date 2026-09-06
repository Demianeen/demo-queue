import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
};
const input = { expectedOrganizationId: "org_outpost", name: "Demo night", slug: "demo-night", eventType: "demo" as const, meetUrl: "https://meet.google.com/example" };
const page = { paginationOpts: { numItems: 2, cursor: null } };
const identity = (org: string) => ({ subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: org });

test("anonymous and organization-less users cannot create or list events", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.events.createEvent, input)).rejects.toThrow("Sign in");
  await expect(t.query(api.events.listOrganizationEvents, page)).rejects.toThrow("Sign in");
  const user = t.withIdentity({ subject: "user_operator" });
  await expect(user.mutation(api.events.createEvent, input)).rejects.toThrow("Choose an organization");
  await expect(user.query(api.events.listOrganizationEvents, page)).rejects.toThrow("Choose an organization");
});

test("creation derives ownership and generates a capability; public projections stay private", async () => {
  const t = convexTest(schema, modules);
  const user = t.withIdentity(identity("org_outpost"));
  const created = await user.mutation(api.events.createEvent, input);
  expect(created.adminToken).toMatch(/^[0-9a-f]{64}$/);
  const document = await t.run((ctx) => ctx.db.get(created.eventId));
  expect(document).toMatchObject({ workosOrganizationId: "org_outpost", adminToken: created.adminToken });
  await expect(t.query(api.events.getAdminEventMeta, { slug: input.slug, adminToken: created.adminToken })).resolves.toMatchObject({ name: input.name });
  await expect(t.query(api.events.getAdminEventMeta, { slug: input.slug, adminToken: "wrong" })).rejects.toThrow("Unauthorized");
  const publicEvent = await t.query(api.events.getEventMeta, { slug: input.slug });
  expect(publicEvent).not.toHaveProperty("adminToken");
  expect(publicEvent).not.toHaveProperty("workosOrganizationId");
});

test("organization listing is paginated and excludes other organizations and legacy events", async () => {
  const t = convexTest(schema, modules);
  const outpost = t.withIdentity(identity("org_outpost"));
  const testOrg = t.withIdentity(identity("org_test"));
  for (let i = 0; i < 3; i++) await outpost.mutation(api.events.createEvent, { ...input, slug: `outpost-${i}` });
  await testOrg.mutation(api.events.createEvent, { ...input, expectedOrganizationId: "org_test", slug: "test-event" });
  await t.run((ctx) => ctx.db.insert("events", { name: input.name, eventType: input.eventType, meetUrl: input.meetUrl, slug: "legacy", adminToken: "old-capability", queuePublished: false, createdAt: 1, updatedAt: 1 }));
  const first = await outpost.query(api.events.listOrganizationEvents, page);
  for (const event of first.page) {
    expect(event).not.toHaveProperty("adminToken");
    expect(event).not.toHaveProperty("theme");
  }
  expect(first.page).toHaveLength(2);
  expect(first.isDone).toBe(false);
  const next = await outpost.query(api.events.listOrganizationEvents, { paginationOpts: { numItems: 2, cursor: first.continueCursor } });
  expect(next.page).toHaveLength(1);
  expect([...first.page, ...next.page].every((event) => event.organizationId === "org_outpost" && event.slug.startsWith("outpost-"))).toBe(true);
  const other = await testOrg.query(api.events.listOrganizationEvents, page);
  expect(other.page.map((event) => event.slug)).toEqual(["test-event"]);
  await expect(t.query(api.events.getAdminEventMeta, { slug: "legacy", adminToken: "old-capability" })).resolves.toMatchObject({ slug: "legacy" });
});

test("clients cannot choose organization ownership or admin capability", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_outpost"));
  // Explicit casts model a malicious client sending fields absent from the public type.
  await expect(t.mutation(api.events.createEvent, { ...input, workosOrganizationId: "org_test" } as typeof input)).rejects.toThrow();
  await expect(t.mutation(api.events.createEvent, { ...input, adminToken: "chosen" } as typeof input)).rejects.toThrow();
  await expect(t.query(api.events.listOrganizationEvents, { ...page, organizationId: "org_test" } as typeof page)).rejects.toThrow();
});

test("invalid creation inputs and duplicate slugs leave no partial events", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_outpost"));
  await expect(t.mutation(api.events.createEvent, { ...input, name: " " })).rejects.toThrow("event name");
  await expect(t.mutation(api.events.createEvent, { ...input, meetUrl: "javascript:alert(1)" })).rejects.toThrow("HTTP");
  await expect(t.mutation(api.events.createEvent, { ...input, slug: "../bad" })).rejects.toThrow("slug");
  await t.mutation(api.events.createEvent, input);
  await expect(t.mutation(api.events.createEvent, input)).rejects.toThrow("already exists");
  expect((await t.query(api.events.listOrganizationEvents, page)).page).toHaveLength(1);
});

// A queued mutation retains its original arguments even if its session refreshes
// into another organization before Convex executes it.
test("a queued creation cannot move to another organization after token refresh", async () => {
  const t = convexTest(schema, modules);
  const switchedSession = t.withIdentity(identity("org_test"));
  await expect(switchedSession.mutation(api.events.createEvent, input)).rejects.toThrow("Your organization changed");
  expect((await switchedSession.query(api.events.listOrganizationEvents, page)).page).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("events").collect())).toEqual([]);
});

test("event details require organization identity and hide missing, foreign and legacy events", async () => {
  const t = convexTest(schema, modules);
  const outpost = t.withIdentity(identity("org_outpost"));
  await outpost.mutation(api.events.createEvent, input);
  await expect(t.query(api.events.getOrganizationEventDetails, { slug: input.slug })).rejects.toThrow("Sign in");
  await expect(t.withIdentity({ subject: "no_org" }).query(api.events.getOrganizationEventDetails, { slug: input.slug })).rejects.toThrow("Choose an organization");
  expect(await t.withIdentity(identity("org_test")).query(api.events.getOrganizationEventDetails, { slug: input.slug })).toBeNull();
  expect(await outpost.query(api.events.getOrganizationEventDetails, { slug: "missing" })).toBeNull();
  await t.run((ctx) => ctx.db.insert("events", { name: "Legacy", slug: "legacy-details", adminToken: "old", meetUrl: input.meetUrl, queuePublished: false, createdAt: 1, updatedAt: 1 }));
  expect(await outpost.query(api.events.getOrganizationEventDetails, { slug: "legacy-details" })).toBeNull();
  const details = await outpost.query(api.events.getOrganizationEventDetails, { slug: input.slug });
  expect(details).toMatchObject({ name: input.name, organizationId: "org_outpost", submissionCount: 0, submissionCountCapped: false, resultsStatus: "not_applicable", winners: [] });
});

test("overview shows only confirmed placements in final order, never draft scores or private submissions", async () => {
  const t = convexTest(schema, modules);
  const user = t.withIdentity(identity("org_outpost"));
  const { eventId } = await user.mutation(api.events.createEvent, { ...input, eventType: "hackathon" });
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await ctx.db.insert("submissions", { eventId, participantToken: `secret-${i}`, name: `Person ${i}`, teamName: `Team ${i}`, demoTitle: `Demo ${i}`, phone: "private-phone", description: "private-description", status: "candidate", createdAt: 1, updatedAt: 1 }));
    return ids;
  });
  const decisionId = await t.run((ctx) => ctx.db.insert("judgingDecisions", { eventId, finalistIds: ids, placementIds: [ids[2], ids[0], ids[1]], finalistVersion: 1, placementVersion: 1, finalistStatus: "submitted", placementStatus: "draft", updatedAt: 1 }));
  const details = () => user.query(api.events.getOrganizationEventDetails, { slug: input.slug });
  expect(await details()).toMatchObject({ submissionCount: 3, resultsStatus: "pending", winners: [] });
  await t.run((ctx) => ctx.db.patch(decisionId, { placementStatus: "submitted" }));
  expect((await details())?.winners).toEqual([]); // Open/setup judging is not final.
  await t.run((ctx) => ctx.db.patch(eventId, { judgingStatus: "closed" }));
  const confirmed = await details();
  expect(confirmed).toMatchObject({ resultsStatus: "confirmed", winners: [
    { place: 1, demoTitle: "Demo 2", teamName: "Team 2" },
    { place: 2, demoTitle: "Demo 0", teamName: "Team 0" },
    { place: 3, demoTitle: "Demo 1", teamName: "Team 1" },
  ] });
  for (const value of ['secret-', 'private-phone', 'private-description', 'participantToken', 'finalistIds', 'placementIds']) expect(JSON.stringify(confirmed)).not.toContain(value);
  await t.run((ctx) => ctx.db.patch(decisionId, { finalistStatus: "needs_review" }));
  expect(await details()).toMatchObject({ resultsStatus: "needs_review", winners: [] });
  await t.run((ctx) => ctx.db.patch(decisionId, { finalistStatus: "submitted", placementStatus: "needs_review" }));
  expect(await details()).toMatchObject({ resultsStatus: "needs_review", winners: [] });
  const other = await user.mutation(api.events.createEvent, { ...input, slug: "other-event" });
  await t.run(async (ctx) => {
    await ctx.db.patch(decisionId, { placementStatus: "submitted" });
    await ctx.db.patch(ids[2], { eventId: other.eventId });
  });
  // Invalid first place cannot promote later places or expose a foreign team's details.
  expect(await details()).toMatchObject({ submissionCount: 2, resultsStatus: "needs_review", winners: [] });
});
