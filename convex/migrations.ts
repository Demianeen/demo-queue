import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { listEventTracks } from "./tracks";
import { MAX_EVENT_TRACKS, MAX_TRACK_NAME_LENGTH, normalizeTrackInput, trackKey } from "../lib/tracks";

// One-off migration: each submission's legacy free-text `category` becomes one
// track of its event. Nothing is deleted: `category` stays on the document.
// Only submissions with a category and no `trackIds` are touched, so the
// migration is safe to run again.

const PAGE_SIZE = 100;

function needsMigration(submission: Doc<"submissions">) {
  return submission.trackIds === undefined && Boolean(submission.category?.trim());
}

function categoryTrackName(category: string) {
  const name = category.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, MAX_TRACK_NAME_LENGTH);
  return normalizeTrackInput({ name }).name;
}

export const planCategoryTracksPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("submissions").paginate(paginationOpts);
    const pending = result.page.filter(needsMigration);
    const trackKeysByEvent = new Map<Id<"events">, Set<string>>();
    for (const submission of pending) {
      if (trackKeysByEvent.has(submission.eventId)) continue;
      const tracks = await listEventTracks(ctx, submission.eventId);
      trackKeysByEvent.set(submission.eventId, new Set(tracks.map((track) => trackKey(track.name))));
    }
    return {
      items: pending.map((submission) => {
        const name = categoryTrackName(submission.category!);
        return {
          eventId: submission.eventId,
          name,
          trackExists: trackKeysByEvent.get(submission.eventId)!.has(trackKey(name)),
        };
      }),
      existingTrackCounts: [...trackKeysByEvent].map(([eventId, keys]) => ({ eventId, count: keys.size })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const migrateCategoryTracksPage = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("submissions").paginate(paginationOpts);
    const tracksByEvent = new Map<Id<"events">, Doc<"eventTracks">[]>();
    let migrated = 0;
    let createdTracks = 0;
    const skipped: Id<"submissions">[] = [];
    const now = Date.now();
    for (const submission of result.page) {
      if (!needsMigration(submission)) continue;
      let tracks = tracksByEvent.get(submission.eventId);
      if (!tracks) {
        tracks = await listEventTracks(ctx, submission.eventId);
        tracksByEvent.set(submission.eventId, tracks);
      }
      const name = categoryTrackName(submission.category!);
      let track = tracks.find((candidate) => trackKey(candidate.name) === trackKey(name));
      if (!track) {
        if (tracks.length >= MAX_EVENT_TRACKS) {
          skipped.push(submission._id);
          continue;
        }
        const order = tracks.reduce((max, candidate) => Math.max(max, candidate.order), -1) + 1;
        const trackId = await ctx.db.insert("eventTracks", {
          eventId: submission.eventId,
          name,
          order,
          createdAt: now,
          updatedAt: now,
        });
        track = (await ctx.db.get(trackId))!;
        tracks.push(track);
        createdTracks += 1;
      }
      await ctx.db.patch(submission._id, { trackIds: [track._id] });
      migrated += 1;
    }
    return { migrated, createdTracks, skipped, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Run with `npx convex run migrations:migrateCategoriesToTracks '{"dryRun":true}'`
 * first, then with `{"dryRun":false}`. A dry run writes nothing.
 */
export const migrateCategoriesToTracks = internalAction({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let cursor: string | null = null;
    let submissions = 0;
    let createdTracks = 0;
    const skipped: Id<"submissions">[] = [];
    if (dryRun) {
      const newTracks = new Map<Id<"events">, Set<string>>();
      const existing = new Map<Id<"events">, number>();
      for (;;) {
        const page: {
          items: { eventId: Id<"events">; name: string; trackExists: boolean }[];
          existingTrackCounts: { eventId: Id<"events">; count: number }[];
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(internal.migrations.planCategoryTracksPage, {
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        });
        for (const { eventId, count } of page.existingTrackCounts) existing.set(eventId, count);
        for (const item of page.items) {
          submissions += 1;
          if (item.trackExists) continue;
          const names = newTracks.get(item.eventId) ?? new Set<string>();
          names.add(trackKey(item.name));
          newTracks.set(item.eventId, names);
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      const overLimitEvents = [...newTracks].filter(
        ([eventId, names]) => (existing.get(eventId) ?? 0) + names.size > MAX_EVENT_TRACKS,
      ).length;
      for (const names of newTracks.values()) createdTracks += names.size;
      return { dryRun, submissions, createdTracks, events: newTracks.size, overLimitEvents, skipped };
    }
    for (;;) {
      const page: {
        migrated: number;
        createdTracks: number;
        skipped: Id<"submissions">[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.migrations.migrateCategoryTracksPage, {
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      });
      submissions += page.migrated;
      createdTracks += page.createdTracks;
      skipped.push(...page.skipped);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { dryRun, submissions, createdTracks, events: null, overLimitEvents: null, skipped };
  },
});
