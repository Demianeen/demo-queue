import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import * as ownership from "./eventOwnership";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./eventOwnership.ts": () => import("./eventOwnership"),
};
type Row = { eventId: Id<"events">; slug: string; expectedOrganizationId: string | null; organizationId: string };
const assign = makeFunctionReference<"mutation", { rows: Row[]; dryRun?: boolean }>("eventOwnership:assign");
const inventory = makeFunctionReference<"query", { paginationOpts: { numItems: number; cursor: string | null } }>("eventOwnership:inventory");
const legacy = { name: "Historical event", slug: "history", adminToken: "preserved-secret", meetUrl: "https://meet.google.com/example", queuePublished: true, createdAt: 1, updatedAt: 2, stageTimerRemainingMs: 1234 };

test("dry run defaults to true and apply changes only ownership, then becomes a noop", async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.run((ctx) => ctx.db.insert("events", legacy));
  const before = await t.run((ctx) => ctx.db.get(eventId));
  const submissionId = await t.run((ctx) => ctx.db.insert("submissions", {
    eventId, participantToken: "preserved-participant-token", name: "Participant",
    demoTitle: "Existing demo", description: "Keep this content", phone: "+440000000000",
    status: "queued", queueOrder: 1, createdAt: 1, updatedAt: 2,
  }));
  const submissionBefore = await t.run((ctx) => ctx.db.get(submissionId));
  const rows = [{ eventId, slug: legacy.slug, expectedOrganizationId: null, organizationId: "org_outpost" }];
  expect(await t.mutation(assign, { rows })).toEqual({ dryRun: true, rows: [{ ...rows[0], currentOrganizationId: null, kind: "change" }] });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual(before);
  await t.mutation(assign, { rows, dryRun: false });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual({ ...before, workosOrganizationId: "org_outpost" });
  expect(await t.run((ctx) => ctx.db.get(submissionId))).toEqual(submissionBefore);
  expect(await t.mutation(assign, { rows, dryRun: false })).toEqual({ dryRun: false, rows: [{ ...rows[0], currentOrganizationId: "org_outpost", kind: "noop" }] });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual({ ...before, workosOrganizationId: "org_outpost" });
});

test("preconditions and duplicate IDs reject the entire batch without changing documents", async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.run((ctx) => ctx.db.insert("events", legacy));
  const foreignId = await t.run((ctx) => ctx.db.insert("events", { ...legacy, slug: "foreign", workosOrganizationId: "org_foreign" }));
  const before = await t.run((ctx) => ctx.db.query("events").collect());
  const row = { eventId, slug: legacy.slug, expectedOrganizationId: null, organizationId: "org_outpost" };
  for (const rows of [
    [row, { ...row, eventId: foreignId, slug: "foreign" }],
    [row, { ...row, eventId: foreignId, slug: "foreign", expectedOrganizationId: "org_foreign" }],
    [row, { ...row, slug: "wrong" }],
    [row, { ...row, eventId: foreignId, slug: "wrong" }],
    [{ ...row, organizationId: "invalid" }],
    [],
    Array.from({ length: 101 }, () => row),
  ]) {
    await expect(t.mutation(assign, { rows, dryRun: false })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toEqual(before);
  }
});

test("inventory pages expose only allowlisted event fields", async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.run((ctx) => ctx.db.insert("events", legacy));
  await t.run((ctx) => ctx.db.insert("events", { ...legacy, slug: "next" }));
  const result = await t.query(inventory, { paginationOpts: { numItems: 1, cursor: null } });
  expect(result.page).toEqual([{ eventId, name: legacy.name, slug: legacy.slug, organizationId: null }]);
  expect(result.isDone).toBe(false);
  const next = await t.query(inventory, { paginationOpts: { numItems: 1, cursor: result.continueCursor } });
  expect(next.page).toHaveLength(1);
  const end = await t.query(inventory, { paginationOpts: { numItems: 1, cursor: next.continueCursor } });
  expect(end.page).toEqual([]);
  expect(end.isDone).toBe(true);
  await expect(t.query(inventory, { paginationOpts: { numItems: 101, cursor: null } })).rejects.toThrow();
});

test("ownership functions are registered internally and cannot be exported as public mutations", () => {
  expect(ownership.assign).toHaveProperty("isInternal", true);
  expect(ownership.assign).not.toHaveProperty("isPublic", true);
  expect(ownership.inventory).toHaveProperty("isInternal", true);
  expect(Object.keys(ownership).sort()).toEqual(["assign", "inventory"]);
});
