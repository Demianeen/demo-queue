import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./tracks.ts": () => import("./tracks"),
  "./migrations.ts": () => import("./migrations"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
};

// Submitting queues an email; keep it queued so it never runs after a test ends.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const organizationId = "org_outpost";
const identity = (org: string) => ({ subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: org });
const input = {
  expectedOrganizationId: organizationId,
  name: "Demo night",
  slug: "demo-night",
  eventType: "demo" as const,
  meetUrl: "https://meet.google.com/example",
};

async function fixture(tracks = [{ name: "AI agents", description: "Agents that act" }, { name: "Developer tools" }, { name: "Open track" }]) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity(identity(organizationId));
  const { eventId } = await owner.mutation(api.events.createEvent, { ...input, tracks });
  const ids = async () => {
    const admin = await owner.query(api.events.getAdmin, { slug: input.slug });
    return admin.tracks.map((track) => track.id);
  };
  return { t, owner, eventId, ids };
}

let tokenCounter = 0;
/** For public submits that must create a submission rather than answer emailTaken. */
async function created<R extends object>(result: Promise<R>) {
  const value = await result;
  if (!("submissionId" in value)) throw new Error("Expected a new submission, got emailTaken");
  return value as Extract<R, { submissionId: unknown }>;
}

function submit(t: ReturnType<typeof convexTest>, trackIds?: Id<"eventTracks">[], slug = input.slug) {
  tokenCounter += 1;
  return created(t.mutation(api.events.submitDemo, {
    slug,
    participantToken: `participant-${tokenCounter}`,
    clientId: `test-browser-${String(tokenCounter).padStart(6, "0")}`,
    name: "Participant",
    demoTitle: `Demo ${tokenCounter}`,
    description: "A working demonstration",
    phone: "+447700900123",
    queueOrder: tokenCounter,
    trackIds,
  }));
}

test("event creation saves tracks in order and the stage and form can read them", async () => {
  const { t, owner } = await fixture();
  const stage = await t.query(api.events.getStage, { slug: input.slug });
  expect(stage.event.tracks.map((track) => track.name)).toEqual(["AI agents", "Developer tools", "Open track"]);
  expect(stage.event.tracks[0]).toMatchObject({ description: "Agents that act" });
  await expect(
    owner.mutation(api.events.createEvent, { ...input, slug: "dupes", tracks: [{ name: "AI" }, { name: " ai " }] }),
  ).rejects.toThrow("listed twice");
  await expect(
    owner.mutation(api.events.createEvent, { ...input, slug: "too-many", tracks: Array.from({ length: 21 }, (_, i) => ({ name: `T${i}` })) }),
  ).rejects.toThrow("no more than 20");
  expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(1);
});

test("a submission can pick none, one or several of its own event's tracks", async () => {
  const { t, owner, ids } = await fixture();
  const [ai, tools, open] = await ids();
  const none = await submit(t);
  const several = await submit(t, [open, ai, open]);
  expect(await t.run((ctx) => ctx.db.get(none.submissionId))).not.toHaveProperty("trackIds");
  expect((await t.run((ctx) => ctx.db.get(several.submissionId)))?.trackIds).toEqual([ai, open]);

  await owner.mutation(api.events.createEvent, { ...input, slug: "other-event", tracks: [{ name: "Elsewhere" }] });
  const other = await owner.query(api.events.getAdmin, { slug: "other-event" });
  await expect(submit(t, [other.tracks[0].id])).rejects.toThrow("Choose tracks from this event.");
  await expect(submit(t, [tools], "other-event")).rejects.toThrow("Choose tracks from this event.");

  const participant = await t.query(api.events.getParticipant, { slug: input.slug, participantToken: `participant-${tokenCounter - 2}` });
  expect(participant?.submission.tracks).toEqual(["AI agents", "Open track"]);
  const admin = await owner.query(api.events.getAdmin, { slug: input.slug });
  expect(admin.tracks.map((track) => track.submissionCount)).toEqual([1, 0, 1]);
  expect(admin.noTrackCount).toBe(1);
});

test("admin edits keep tracks unless the edit sends new ones", async () => {
  const { t, owner, ids } = await fixture();
  const [ai, tools] = await ids();
  const { submissionId } = await submit(t, [ai]);
  const edit = { slug: input.slug, submissionId, name: "Participant", demoTitle: "Renamed", description: "Still works", phone: "+447700900123" };
  await owner.mutation(api.events.updateSubmission, edit);
  expect((await t.run((ctx) => ctx.db.get(submissionId)))?.trackIds).toEqual([ai]);
  await owner.mutation(api.events.updateSubmission, { ...edit, trackIds: [tools] });
  expect((await t.run((ctx) => ctx.db.get(submissionId)))?.trackIds).toEqual([tools]);
  await owner.mutation(api.events.updateSubmission, { ...edit, trackIds: [] });
  expect((await t.run((ctx) => ctx.db.get(submissionId)))?.trackIds).toEqual([]);
});

test("track admin rejects anonymous callers, other organizations and other events' tracks", async () => {
  const { t, owner, ids } = await fixture();
  const [ai] = await ids();
  for (const [caller, reason] of [[t, "Sign in"], [t.withIdentity(identity("org_foreign")), "Unauthorized"]] as const) {
    await expect(caller.mutation(api.tracks.addTrack, { slug: input.slug, name: "Sneaky" })).rejects.toThrow(reason);
    await expect(caller.mutation(api.tracks.updateTrack, { slug: input.slug, trackId: ai, name: "Sneaky" })).rejects.toThrow(reason);
    await expect(caller.mutation(api.tracks.reorderTracks, { slug: input.slug, orderedIds: [] })).rejects.toThrow(reason);
    await expect(caller.mutation(api.tracks.removeTrack, { slug: input.slug, trackId: ai, confirmInUse: true })).rejects.toThrow(reason);
  }
  await owner.mutation(api.events.createEvent, { ...input, slug: "second" });
  await expect(owner.mutation(api.tracks.updateTrack, { slug: "second", trackId: ai, name: "Moved" })).rejects.toThrow("Track not found.");
  await expect(owner.mutation(api.tracks.removeTrack, { slug: "second", trackId: ai, confirmInUse: true })).rejects.toThrow("Track not found.");
  expect((await t.run((ctx) => ctx.db.get(ai)))?.name).toBe("AI agents");
});

test("add and rename keep names unique, and a rename shows everywhere", async () => {
  const { t, owner, ids } = await fixture();
  const [ai] = await ids();
  const { submissionId } = await submit(t, [ai]);
  await expect(owner.mutation(api.tracks.addTrack, { slug: input.slug, name: "open TRACK" })).rejects.toThrow("already a track");
  await expect(owner.mutation(api.tracks.updateTrack, { slug: input.slug, trackId: ai, name: "Developer Tools" })).rejects.toThrow("already a track");
  await owner.mutation(api.tracks.addTrack, { slug: input.slug, name: "Hardware" });
  await owner.mutation(api.tracks.updateTrack, { slug: input.slug, trackId: ai, name: "Agents" });
  const stage = await t.query(api.events.getStage, { slug: input.slug });
  expect(stage.event.tracks.map((track) => track.name)).toEqual(["Agents", "Developer tools", "Open track", "Hardware"]);
  const participant = await t.run((ctx) => ctx.db.get(submissionId));
  expect(participant?.trackIds).toEqual([ai]);
  const admin = await owner.query(api.events.getAdmin, { slug: input.slug });
  expect(admin.lineup.concat(admin.pool).find((row) => row.id === submissionId)?.tracks).toEqual(["Agents"]);
});

test("reorder needs every track once and keeps submission tracks in the new order", async () => {
  const { t, owner, ids } = await fixture();
  const [ai, tools, open] = await ids();
  const { submissionId } = await submit(t, [ai, open]);
  await expect(owner.mutation(api.tracks.reorderTracks, { slug: input.slug, orderedIds: [open, ai] })).rejects.toThrow("every track once");
  await expect(owner.mutation(api.tracks.reorderTracks, { slug: input.slug, orderedIds: [open, ai, ai] })).rejects.toThrow("every track once");
  await owner.mutation(api.tracks.reorderTracks, { slug: input.slug, orderedIds: [open, tools, ai] });
  expect(await ids()).toEqual([open, tools, ai]);
  expect((await t.run((ctx) => ctx.db.get(submissionId)))?.trackIds).toEqual([open, ai]);
});

test("removing a track in use needs confirmation and leaves other tracks on the submission", async () => {
  const { t, owner, ids } = await fixture();
  const [ai, tools, open] = await ids();
  const { submissionId } = await submit(t, [ai, open]);
  await expect(owner.mutation(api.tracks.removeTrack, { slug: input.slug, trackId: ai, confirmInUse: false })).rejects.toThrow(
    "1 submission picked AI agents. Confirm to remove it from them.",
  );
  expect(await t.run((ctx) => ctx.db.get(ai))).not.toBeNull();
  expect(await owner.mutation(api.tracks.removeTrack, { slug: input.slug, trackId: tools, confirmInUse: false })).toEqual({ removedFromSubmissions: 0 });
  expect(await owner.mutation(api.tracks.removeTrack, { slug: input.slug, trackId: ai, confirmInUse: true })).toEqual({ removedFromSubmissions: 1 });
  expect((await t.run((ctx) => ctx.db.get(submissionId)))?.trackIds).toEqual([open]);
  expect(await ids()).toEqual([open]);
  const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(log.map((entry) => entry.action)).toEqual(expect.arrayContaining(["track_removed"]));
});

test("the category migration turns each legacy category into one track, safely and only once", async () => {
  const { t, eventId, ids } = await fixture([{ name: "AI agents" }]);
  const [ai] = await ids();
  const other = await t.run((ctx) =>
    ctx.db.insert("events", { name: "Old", slug: "old", meetUrl: input.meetUrl, queuePublished: false, createdAt: 1, updatedAt: 1 }),
  );
  const legacy = async (event: Id<"events">, category: string | undefined, trackIds?: Id<"eventTracks">[]) =>
    t.run((ctx) =>
      ctx.db.insert("submissions", {
        eventId: event, participantToken: `legacy-${Math.random()}`, name: "Legacy", demoTitle: "Old demo",
        description: "Before tracks", phone: "+447700900123", status: "candidate", createdAt: 1, updatedAt: 1,
        ...(category === undefined ? {} : { category }), ...(trackIds ? { trackIds } : {}),
      }),
    );
  const aiLegacy = await legacy(eventId, "ai AGENTS");
  const hardware = await legacy(eventId, " Hardware ");
  const hardwareAgain = await legacy(eventId, "hardware");
  const oldEvent = await legacy(other, "Hardware");
  const blank = await legacy(eventId, "  ");
  const alreadyPicked = await legacy(eventId, "Fintech", []);

  const plan = await t.action(internal.migrations.migrateCategoriesToTracks, { dryRun: true });
  expect(plan).toMatchObject({ dryRun: true, submissions: 4, createdTracks: 2, events: 2, overLimitEvents: 0 });
  expect(await t.run((ctx) => ctx.db.query("eventTracks").collect())).toHaveLength(1);
  expect((await t.run((ctx) => ctx.db.get(aiLegacy)))?.trackIds).toBeUndefined();

  const applied = await t.action(internal.migrations.migrateCategoriesToTracks, { dryRun: false });
  expect(applied).toMatchObject({ dryRun: false, submissions: 4, createdTracks: 2, skipped: [] });
  const doc = (id: Id<"submissions">) => t.run((ctx) => ctx.db.get(id));
  expect((await doc(aiLegacy))?.trackIds).toEqual([ai]);
  expect((await doc(aiLegacy))?.category).toBe("ai AGENTS");
  const hardwareIds = (await doc(hardware))?.trackIds;
  expect(hardwareIds).toHaveLength(1);
  expect((await doc(hardwareAgain))?.trackIds).toEqual(hardwareIds);
  expect((await t.run((ctx) => ctx.db.get(hardwareIds![0])))).toMatchObject({ eventId, name: "Hardware", order: 1 });
  const oldTrack = (await doc(oldEvent))?.trackIds?.[0];
  expect(await t.run((ctx) => ctx.db.get(oldTrack!))).toMatchObject({ eventId: other, name: "Hardware" });
  expect((await doc(blank))?.trackIds).toBeUndefined();
  expect((await doc(alreadyPicked))?.trackIds).toEqual([]);

  expect(await t.action(internal.migrations.migrateCategoriesToTracks, { dryRun: false })).toMatchObject({ submissions: 0, createdTracks: 0 });
});

test("the migration skips submissions it cannot fit under the track limit", async () => {
  const { t, eventId } = await fixture(Array.from({ length: 20 }, (_, i) => ({ name: `Track ${i}` })));
  const id = await t.run((ctx) =>
    ctx.db.insert("submissions", {
      eventId, participantToken: "full", name: "Legacy", demoTitle: "Old demo", description: "", phone: "+447700900123",
      status: "candidate", category: "Hardware", createdAt: 1, updatedAt: 1,
    }),
  );
  expect(await t.action(internal.migrations.migrateCategoriesToTracks, { dryRun: true })).toMatchObject({ overLimitEvents: 1 });
  expect(await t.action(internal.migrations.migrateCategoriesToTracks, { dryRun: false })).toMatchObject({ submissions: 0, skipped: [id] });
  expect((await t.run((ctx) => ctx.db.get(id)))?.trackIds).toBeUndefined();
});
