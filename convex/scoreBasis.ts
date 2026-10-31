import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * The score basis: a version that grows with every change to the scores
 * normalization uses, and the version the organiser last confirmed.
 *
 * It lives in its own small document, not on the event, because it changes
 * with every completed score: a patch to the event would re-run every query
 * that reads the event (the admin page's submissions, the stage, the event
 * details) each time a judge saves. Events from before this read the two
 * fields they kept on the event until their first write here.
 */
export type ScoreBasis = { version: number; confirmedVersion: number | undefined };

async function stored(ctx: QueryCtx, eventId: Id<"events">) {
  return await ctx.db.query("scoreBases").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
}

export async function readScoreBasis(ctx: QueryCtx, event: Doc<"events">): Promise<ScoreBasis> {
  const doc = await stored(ctx, event._id);
  return doc
    ? { version: doc.version, confirmedVersion: doc.confirmedVersion }
    : { version: event.scoreBasisVersion ?? 0, confirmedVersion: event.confirmedScoreBasisVersion };
}

async function write(ctx: MutationCtx, event: Doc<"events">, next: (current: ScoreBasis) => ScoreBasis, now: number) {
  const doc = await stored(ctx, event._id);
  const current = doc
    ? { version: doc.version, confirmedVersion: doc.confirmedVersion }
    : { version: event.scoreBasisVersion ?? 0, confirmedVersion: event.confirmedScoreBasisVersion };
  const value = next(current);
  if (doc) await ctx.db.patch(doc._id, { version: value.version, confirmedVersion: value.confirmedVersion, updatedAt: now });
  else await ctx.db.insert("scoreBases", { eventId: event._id, version: value.version, confirmedVersion: value.confirmedVersion, updatedAt: now });
  return value;
}

/** Scores changed: a new version, and nothing confirmed for it yet. */
export async function bumpScoreBasis(ctx: MutationCtx, event: Doc<"events">, now = Date.now()) {
  return await write(ctx, event, (current) => ({ version: current.version + 1, confirmedVersion: undefined }), now);
}

/** The organiser confirmed normalization for the current version. Returns that version. */
export async function confirmScoreBasis(ctx: MutationCtx, event: Doc<"events">, now = Date.now()) {
  return (await write(ctx, event, (current) => ({ version: current.version, confirmedVersion: current.version }), now)).version;
}

/** Removes an event's score basis, when the event's judging data goes. */
export async function deleteScoreBasis(ctx: MutationCtx, eventId: Id<"events">) {
  const doc = await stored(ctx, eventId);
  if (doc) await ctx.db.delete(doc._id);
}
