import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireEventOrganization } from "./organizationAuth";
import { queueJudgingSheetSync } from "./judgingSheetSync";
import { queueAiSummaryIfStale, SUMMARY_STAGGER_MS } from "./aiSummaries";
import {
  MAX_EVENT_TRACKS,
  normalizeTrackInput,
  normalizeTrackList,
  submissionTrackNames,
  trackKey,
  type TrackInput,
} from "../lib/tracks";

// Submissions per event are bounded elsewhere at 1000; track edits stay inside that.
const MAX_EVENT_SUBMISSIONS = 1000;

export const trackInputValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
});

function toConvexError(error: unknown): never {
  if (error instanceof ConvexError) throw error;
  throw new ConvexError(error instanceof Error ? error.message : "Invalid track.");
}

export async function listEventTracks(ctx: Pick<QueryCtx, "db">, eventId: Id<"events">) {
  return await ctx.db
    .query("eventTracks")
    .withIndex("by_event_and_order", (q) => q.eq("eventId", eventId))
    .take(MAX_EVENT_TRACKS + 1);
}

export function tracksById(tracks: Doc<"eventTracks">[]) {
  return new Map(tracks.map((track) => [track._id, track]));
}

export function publicTrack(track: Doc<"eventTracks">) {
  return { id: track._id, name: track.name, description: track.description };
}

export function trackNamesFor(
  submission: Pick<Doc<"submissions">, "trackIds" | "category">,
  byId: ReadonlyMap<Id<"eventTracks">, Doc<"eventTracks">>,
) {
  return submissionTrackNames(submission, byId);
}

/**
 * Validates a submission's track choice against the event: every id must be
 * one of the event's tracks. Returns the ids deduplicated, in track order.
 */
export async function normalizeTrackSelection(
  ctx: Pick<QueryCtx, "db">,
  eventId: Id<"events">,
  trackIds: Id<"eventTracks">[],
) {
  if (trackIds.length > MAX_EVENT_TRACKS) throw new ConvexError("Choose fewer tracks.");
  const tracks = await listEventTracks(ctx, eventId);
  const allowed = new Set(tracks.map((track) => track._id));
  const chosen = new Set<Id<"eventTracks">>();
  for (const id of trackIds) {
    if (!allowed.has(id)) {
      // A track removed while the form was open: drop it, as removing it did for saved submissions.
      if ((await ctx.db.get(id)) === null) continue;
      throw new ConvexError("Choose tracks from this event.");
    }
    chosen.add(id);
  }
  return tracks.filter((track) => chosen.has(track._id)).map((track) => track._id);
}

export async function insertEventTracks(
  ctx: MutationCtx,
  eventId: Id<"events">,
  inputs: TrackInput[],
) {
  let tracks;
  try {
    tracks = normalizeTrackList(inputs);
  } catch (error) {
    toConvexError(error);
  }
  const now = Date.now();
  for (const [order, track] of tracks.entries()) {
    await ctx.db.insert("eventTracks", { eventId, ...track, order, createdAt: now, updatedAt: now });
  }
}

async function adminTrack(ctx: MutationCtx, slug: string, trackId: Id<"eventTracks">) {
  const { event, actor } = await requireEventOrganization(ctx, slug);
  const track = await ctx.db.get(trackId);
  if (!track || track.eventId !== event._id) throw new ConvexError("Track not found.");
  return { event, actor, track };
}

function assertUniqueName(tracks: Doc<"eventTracks">[], name: string, exceptId?: Id<"eventTracks">) {
  const key = trackKey(name);
  if (tracks.some((track) => track._id !== exceptId && trackKey(track.name) === key)) {
    throw new ConvexError(`There is already a track called "${name}".`);
  }
}

async function logTrackAction(ctx: MutationCtx, eventId: Id<"events">, action: string, actor: string, details: string) {
  await ctx.db.insert("auditLog", { eventId, action, actor, details, createdAt: Date.now() });
}

async function eventSubmissions(ctx: MutationCtx, eventId: Id<"events">) {
  return await ctx.db
    .query("submissions")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .take(MAX_EVENT_SUBMISSIONS);
}

export const addTrack = mutation({
  args: { slug: v.string(), name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { event, actor } = await requireEventOrganization(ctx, args.slug);
    let input;
    try {
      input = normalizeTrackInput(args);
    } catch (error) {
      toConvexError(error);
    }
    const tracks = await listEventTracks(ctx, event._id);
    if (tracks.length >= MAX_EVENT_TRACKS) throw new ConvexError(`An event can have up to ${MAX_EVENT_TRACKS} tracks.`);
    assertUniqueName(tracks, input.name);
    const now = Date.now();
    const order = tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1;
    const trackId = await ctx.db.insert("eventTracks", {
      eventId: event._id,
      ...input,
      order,
      createdAt: now,
      updatedAt: now,
    });
    await logTrackAction(ctx, event._id, "track_added", actor, input.name);
    return { trackId };
  },
});

export const updateTrack = mutation({
  args: {
    slug: v.string(),
    trackId: v.id("eventTracks"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { event, actor, track } = await adminTrack(ctx, args.slug, args.trackId);
    let input;
    try {
      input = normalizeTrackInput(args);
    } catch (error) {
      toConvexError(error);
    }
    assertUniqueName(await listEventTracks(ctx, event._id), input.name, track._id);
    await ctx.db.patch(track._id, { name: input.name, description: input.description, updatedAt: Date.now() });
    await logTrackAction(ctx, event._id, "track_updated", actor, `${track.name} -> ${input.name}`);
    await queueJudgingSheetSync(ctx, event);
    // The AI read gives each picked track a fit level from its description: rewrite those of the teams that picked it.
    if ((input.description ?? "").trim() !== (track.description ?? "").trim()) {
      const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
      let queued = 0;
      for (const submission of submissions) {
        if (!(submission.trackIds ?? []).includes(track._id)) continue;
        if (await queueAiSummaryIfStale(ctx, event, submission, queued * SUMMARY_STAGGER_MS, { contextChanged: true, submissionCount: submissions.length })) queued += 1;
      }
    }
  },
});

export const reorderTracks = mutation({
  args: { slug: v.string(), orderedIds: v.array(v.id("eventTracks")) },
  handler: async (ctx, args) => {
    const { event, actor } = await requireEventOrganization(ctx, args.slug);
    const tracks = await listEventTracks(ctx, event._id);
    const ids = new Set(args.orderedIds);
    if (
      ids.size !== args.orderedIds.length ||
      ids.size !== tracks.length ||
      tracks.some((track) => !ids.has(track._id))
    ) {
      throw new ConvexError("Reorder must include every track once.");
    }
    const now = Date.now();
    for (const [order, id] of args.orderedIds.entries()) {
      const track = tracks.find((candidate) => candidate._id === id)!;
      if (track.order !== order) await ctx.db.patch(id, { order, updatedAt: now });
    }
    // Keep each submission's ids in the new track order.
    const position = new Map(args.orderedIds.map((id, index) => [id, index]));
    for (const submission of await eventSubmissions(ctx, event._id)) {
      if (!submission.trackIds || submission.trackIds.length < 2) continue;
      const sorted = [...submission.trackIds].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
      if (sorted.some((id, index) => id !== submission.trackIds![index])) {
        await ctx.db.patch(submission._id, { trackIds: sorted });
      }
    }
    await logTrackAction(ctx, event._id, "tracks_reordered", actor, String(args.orderedIds.length));
    await queueJudgingSheetSync(ctx, event);
  },
});

export const removeTrack = mutation({
  args: { slug: v.string(), trackId: v.id("eventTracks"), confirmInUse: v.boolean() },
  handler: async (ctx, args) => {
    const { event, actor, track } = await adminTrack(ctx, args.slug, args.trackId);
    const using = (await eventSubmissions(ctx, event._id)).filter((submission) =>
      submission.trackIds?.includes(track._id),
    );
    if (using.length > 0 && !args.confirmInUse) {
      throw new ConvexError(
        `${using.length} submission${using.length === 1 ? "" : "s"} picked ${track.name}. Confirm to remove it from them.`,
      );
    }
    const now = Date.now();
    for (const submission of using) {
      await ctx.db.patch(submission._id, {
        trackIds: submission.trackIds!.filter((id) => id !== track._id),
        updatedAt: now,
      });
    }
    await ctx.db.delete(track._id);
    await logTrackAction(ctx, event._id, "track_removed", actor, `${track.name} (${using.length})`);
    if (using.length > 0) await queueJudgingSheetSync(ctx, event);
    return { removedFromSubmissions: using.length };
  },
});
