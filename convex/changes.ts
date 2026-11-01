import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOrganization, requireOwnedEvent, type OrganizationPrincipal } from "./organizationAuth";
import { CHANGE_RETENTION_MS, VERSIONED_TABLES, docVersion, insertChange, storedValueMatches, type ChangeDoc, type ChangeTable } from "./changeLog";
import { movePhase } from "./phases";
import { queueJudgingSheetSync } from "./judgingSheetSync";
import { queueSummariesForEvent, summaryMode } from "./aiSummaries";
import { eventPhase, PHASE_LABELS } from "../lib/event-phase";
import { bumpScoreBasis } from "./scoreBasis";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CONFLICT_SCAN = 200;
/** Documents the list reads, newest change first, to check what can be undone. */
const LIST_CHECK_BUDGET = 1_000;
const TIMER_CHANGE = /_timer_/;
export const TOO_LARGE_TO_CHECK = "This change is too large to check here. Undo newer changes first.";
const TABLES_WITH_UPDATED_AT = new Set<ChangeTable>(["events", "submissions", "reviews", "judgeAccess", "normalizationDecisions"]);

type AnyDoc = Record<string, unknown>;

async function current(ctx: Pick<QueryCtx, "db">, table: ChangeTable, id: string) {
  const normalized = ctx.db.normalizeId(table, id);
  return normalized ? ((await ctx.db.get(normalized)) as AnyDoc | null) : null;
}

/**
 * The documents and fields of a change that no longer hold the value it
 * left. A document whose version moved was written since, even when no
 * logged change did it.
 */
async function staleParts(ctx: Pick<QueryCtx, "db">, change: Doc<"eventChanges">) {
  const stale: { doc: ChangeDoc; fields: string[]; missing: boolean; rewritten: boolean }[] = [];
  for (const doc of change.docs) {
    const now = await current(ctx, doc.table, doc.id);
    if (!now) {
      stale.push({ doc, fields: doc.fields.map((field) => field.name), missing: true, rewritten: false });
      continue;
    }
    const fields: string[] = [];
    for (const field of doc.fields) {
      if (!(await storedValueMatches(doc.table, field.name, now[field.name], field.after))) fields.push(field.name);
    }
    const rewritten = doc.version !== undefined && docVersion(doc.table, now) !== doc.version;
    if (fields.length > 0 || rewritten) stale.push({ doc, fields, missing: false, rewritten });
  }
  return stale;
}

async function titleOf(ctx: Pick<QueryCtx, "db">, id: Id<"submissions">) {
  return (await ctx.db.get(id))?.demoTitle ?? "a project";
}

/**
 * Writes that the change does not cover but that undoing it would break:
 * scores or team members added to a submission it inserted, scores given by
 * judges it assigned, and a review that moving scores back would duplicate.
 */
async function dependentBlocker(ctx: Pick<QueryCtx, "db">, change: Doc<"eventChanges">) {
  const inChange = new Set(change.docs.map((doc) => `${doc.table}:${doc.id}`));
  for (const doc of change.docs) {
    if (doc.op === "insert" && doc.table === "submissions") {
      const id = ctx.db.normalizeId("submissions", doc.id);
      if (!id) continue;
      const scored = await ctx.db.query("reviews").withIndex("by_submission", (q) => q.eq("submissionId", id)).first();
      if (scored) return `${await titleOf(ctx, id)} has scores now, so adding it can't be undone.`;
      const members = await ctx.db.query("teamMembers").withIndex("by_submission", (q) => q.eq("submissionId", id)).take(50);
      if (members.some((member) => !inChange.has(`teamMembers:${member._id}`))) {
        return `${await titleOf(ctx, id)} has new team members since, so adding it can't be undone.`;
      }
    }
    if (doc.op === "patch" && doc.table === "submissions" && doc.fields.some((field) => field.name === "roundOneAssignedJudges")) {
      const id = ctx.db.normalizeId("submissions", doc.id);
      if (!id) continue;
      const reviews = await ctx.db.query("reviews").withIndex("by_submission", (q) => q.eq("submissionId", id)).take(50);
      if (reviews.some((review) => review.updatedAt > change._creationTime)) {
        return `${await titleOf(ctx, id)} was scored since by its new judges, so its judges can't be swapped back.`;
      }
    }
    if (doc.op === "patch" && doc.table === "reviews") {
      const judgeKey = doc.fields.find((field) => field.name === "judgeKey")?.before;
      const id = ctx.db.normalizeId("reviews", doc.id);
      const review = id ? await ctx.db.get(id) : null;
      if (typeof judgeKey !== "string" || !review) continue;
      const clash = await ctx.db.query("reviews")
        .withIndex("by_submission_and_judge", (q) => q.eq("submissionId", review.submissionId).eq("judgeKey", judgeKey))
        .first();
      if (clash && clash._id !== review._id) {
        return `${await titleOf(ctx, review.submissionId)} was scored on the first judge's link since, so the scores can't be moved back.`;
      }
    }
  }
  return null;
}

/**
 * Why a change cannot be undone right now, or null when it can. `recent` is
 * the newest change rows, read once by the list; the undo reads its own.
 */
async function undoBlocker(ctx: Pick<QueryCtx, "db">, event: Doc<"events">, change: Doc<"eventChanges">, recent?: Doc<"eventChanges">[]) {
  if (change.undoneAt !== undefined) return "This change was already undone.";
  if (change.undo === "none") return change.noUndoReason ?? "This change can't be undone.";
  if (change.undo === "phase") {
    const phase = eventPhase(event);
    if (change.toPhase && phase !== change.toPhase) {
      return `The event has moved to ${PHASE_LABELS[phase]} since. Move it there from the phase switch instead.`;
    }
    return null;
  }
  // A timer change belongs to its phase: moving phases pauses or resumes
  // timers, so undoing one in another phase would get round those rules.
  if (TIMER_CHANGE.test(change.kind) && change.phaseAtChange && eventPhase(event) !== change.phaseAtChange) {
    return `The event has moved to ${PHASE_LABELS[eventPhase(event)]} since, so this timer change can't be undone. Set the timer again instead.`;
  }
  const stale = await staleParts(ctx, change);
  if (stale.some((part) => part.missing)) return "Something this change touched was deleted since, so it can't be undone.";
  const dependent = await dependentBlocker(ctx, change);
  if (dependent) return dependent;
  // An insert keeps no field values, so a later change to the inserted
  // document is found by its id, and by its version when it has one.
  const inserted = new Set(change.docs.filter((doc) => doc.op === "insert").map((doc) => `${doc.table}:${doc.id}`));
  if (stale.length === 0 && inserted.size === 0) return null;
  const rows = recent ?? (await ctx.db.query("eventChanges").withIndex("by_event", (q) => q.eq("eventId", event._id)).order("desc").take(CONFLICT_SCAN));
  const later = rows.filter((row) => row._creationTime > change._creationTime && row.undoneAt === undefined && row._id !== change._id);
  const touched = new Set(stale.flatMap((part) => part.fields.map((field) => `${part.doc.table}:${part.doc.id}:${field}`)));
  const rewritten = new Set(stale.filter((part) => part.rewritten).map((part) => `${part.doc.table}:${part.doc.id}`));
  const blocker = later.find((row) =>
    row.docs.some((doc) => inserted.has(`${doc.table}:${doc.id}`) || rewritten.has(`${doc.table}:${doc.id}`) || doc.fields.some((field) => touched.has(`${doc.table}:${doc.id}:${field.name}`))),
  );
  if (stale.length === 0 && !blocker) return null;
  return blocker
    ? `Changed again since: undo "${blocker.summary}" first.`
    : "This was changed again since, so undoing it would overwrite newer work.";
}

/** Restoring a submission's email key must not give one email to two submissions. */
async function assertEmailsFree(ctx: MutationCtx, eventId: Id<"events">, doc: ChangeDoc) {
  if (doc.table !== "submissions" && doc.table !== "teamMembers") return;
  const field = doc.fields.find((item) => item.name === "normalizedEmail");
  const key = typeof field?.before === "string" ? field.before : "";
  if (!key) return;
  const [submissions, members] = await Promise.all([
    ctx.db.query("submissions").withIndex("by_event_and_normalized_email", (q) => q.eq("eventId", eventId).eq("normalizedEmail", key)).take(5),
    ctx.db.query("teamMembers").withIndex("by_event_and_normalized_email", (q) => q.eq("eventId", eventId).eq("normalizedEmail", key)).take(5),
  ]);
  const own = doc.table === "submissions" ? doc.id : String((await current(ctx, "teamMembers", doc.id))?.submissionId ?? "");
  const holders = [
    ...submissions.filter((row) => String(row._id) !== own),
    ...members.filter((row) => String(row._id) !== doc.id && String(row.submissionId) !== own),
  ];
  if (holders.length > 0) throw new ConvexError("Another submission now uses an email from this one. Change that email first.");
}

function inverse(doc: ChangeDoc, now: number): ChangeDoc {
  if (doc.op === "insert") return { table: doc.table, id: doc.id, op: "delete", fields: [] };
  return {
    ...doc,
    ...(VERSIONED_TABLES.has(doc.table) ? { version: now } : {}),
    fields: doc.fields.map((field) => ({
      name: field.name,
      ...(field.after !== undefined ? { before: field.after } : {}),
      ...(field.before !== undefined ? { after: field.before } : {}),
    })),
  };
}

async function applySnapshotUndo(ctx: MutationCtx, event: Doc<"events">, change: Doc<"eventChanges">) {
  for (const doc of change.docs) await assertEmailsFree(ctx, event._id, doc);
  const now = Date.now();
  for (const doc of change.docs) {
    const id = ctx.db.normalizeId(doc.table, doc.id);
    if (!id) throw new ConvexError("Something this change touched was deleted since, so it can't be undone.");
    if (doc.op === "insert") {
      await ctx.db.delete(id);
      continue;
    }
    const patch: AnyDoc = Object.fromEntries(doc.fields.map((field) => [field.name, field.before]));
    if (TABLES_WITH_UPDATED_AT.has(doc.table)) patch.updatedAt = now;
    await ctx.db.patch(id, patch as never);
  }
  // Scores changed: normalization recomputes, as after any contributing score edit.
  if (change.docs.some((doc) => doc.table === "reviews")) {
    await bumpScoreBasis(ctx, event, now);
    await ctx.db.patch(event._id, { updatedAt: now });
    for (const decision of await ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200)) {
      await ctx.db.patch(decision._id, { stale: true, updatedAt: now });
    }
  }
  return change.docs.map((doc) => inverse(doc, now));
}

export const undoChangeArgs = v.object({ slug: v.string(), changeId: v.string() });

/**
 * Reverses one change. It refuses, saying why, when a later change touched
 * the same fields (naming it), when something it touched was deleted, or
 * when it was already undone, so an undo never overwrites newer work. The
 * undo is itself a change, so it can be undone too.
 */
export async function undoChangeForOrganization(ctx: MutationCtx, args: Infer<typeof undoChangeArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  const changeId = ctx.db.normalizeId("eventChanges", args.changeId);
  const change = changeId ? await ctx.db.get(changeId) : null;
  if (!change || change.eventId !== event._id) throw new ConvexError("Change not found.");
  const blocker = await undoBlocker(ctx, event, change);
  if (blocker) throw new ConvexError(blocker);
  const now = Date.now();
  let undoId: Id<"eventChanges">;
  if (change.undo === "phase") {
    const to = change.fromPhase ?? eventPhase(event);
    const before = eventPhase(event);
    await movePhase(ctx, event, to);
    undoId = await insertChange(ctx, {
      event, principal, kind: "undo", summary: `undid "${change.summary}"`, undo: "phase", fromPhase: before, toPhase: to, undoLabel: "Undo",
    }, [], { undoOf: change._id });
  } else {
    const docs = await applySnapshotUndo(ctx, event, change);
    undoId = await insertChange(ctx, { event, principal, kind: "undo", summary: `undid "${change.summary}"`, undoLabel: "Undo" }, docs, { undoOf: change._id });
  }
  await ctx.db.patch(change._id, { undoneAt: now, undoneBy: undoId });
  // Undoing an undo puts the first change back, so it can be undone again.
  if (change.undoOf) {
    const first = await ctx.db.get(change.undoOf);
    if (first && first.undoneBy === change._id) await ctx.db.patch(first._id, { undoneAt: undefined, undoneBy: undefined });
  }
  const latest = await ctx.db.get(event._id);
  if (latest && latest.eventType === "hackathon") await queueJudgingSheetSync(ctx, latest);
  // Undoing a practice event's summary switch replaces the summaries again.
  if (latest && summaryMode(latest) !== summaryMode(event)) await queueSummariesForEvent(ctx, latest);
  return { undoneChangeId: change._id, undoChangeId: undoId };
}

export const undoChange = mutation({
  args: undoChangeArgs,
  handler: async (ctx, args) => undoChangeForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const listRecentChangesArgs = v.object({ slug: v.string(), limit: v.optional(v.number()) });

/**
 * Recent changes, newest first, for the live event home and the Undo toast.
 * Each row says whether it can be undone now and, when not, why. Names come
 * from the members list by actorUserId; isYou marks the viewer's own changes
 * (the toast undoes the newest of those).
 */
export async function listRecentChangesForOrganization(ctx: QueryCtx, args: Infer<typeof listRecentChangesArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.limit ?? DEFAULT_LIMIT)));
  // One read of the newest rows serves the list and every row's conflict check.
  const recent = await ctx.db.query("eventChanges").withIndex("by_event", (q) => q.eq("eventId", event._id)).order("desc").take(Math.max(CONFLICT_SCAN, limit + 1));
  const rows = recent.slice(0, limit + 1);
  let budget = LIST_CHECK_BUDGET;
  const blockers: (string | null)[] = [];
  for (const row of rows.slice(0, limit)) {
    const reads = row.undo === "snapshot" && row.undoneAt === undefined ? row.docs.length : 0;
    if (reads > budget) { blockers.push(TOO_LARGE_TO_CHECK); continue; }
    budget -= reads;
    blockers.push(await undoBlocker(ctx, event, row, recent));
  }
  const changes = rows.slice(0, limit).map((row, index) => {
    const blocker = blockers[index];
    return {
      id: row._id,
      createdAt: row.createdAt,
      actorUserId: row.actorUserId ?? null,
      isYou: row.actor === principal.actor,
      via: row.via,
      kind: row.kind,
      summary: row.summary,
      subjectId: row.subjectId ?? null,
      undoLabel: row.undoLabel,
      canUndo: blocker === null,
      undoBlockedReason: blocker,
      undoneAt: row.undoneAt ?? null,
      isUndo: row.undoOf !== undefined,
    };
  });
  return { changes, hasMore: rows.length > limit };
}

export const listRecentChanges = query({
  args: listRecentChangesArgs,
  handler: async (ctx, args) => listRecentChangesForOrganization(ctx, args, await requireOrganization(ctx)),
});

/** Change rows can be up to 600 KB each, so a batch stays small. */
const RETENTION_BATCH = 20;

/**
 * Daily: deletes change rows older than CHANGE_RETENTION_MS (Proposed: 30
 * days), a batch at a time, scheduling itself again until none are left.
 */
export const deleteOldChanges = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - CHANGE_RETENTION_MS;
    const rows = await ctx.db.query("eventChanges").withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff)).take(RETENTION_BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === RETENTION_BATCH) await ctx.scheduler.runAfter(0, internal.changes.deleteOldChanges, {});
    return { deleted: rows.length };
  },
});
