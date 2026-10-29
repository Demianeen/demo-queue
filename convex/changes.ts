import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOrganization, requireOwnedEvent, type OrganizationPrincipal } from "./organizationAuth";
import { deepEqual, insertChange, type ChangeDoc, type ChangeTable } from "./changeLog";
import { movePhase } from "./phases";
import { queueJudgingSheetSync } from "./judgingSheetSync";
import { eventPhase, PHASE_LABELS } from "../lib/event-phase";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CONFLICT_SCAN = 200;
/** Rows with more documents than this skip the live conflict check in the list. */
const LIST_CHECK_DOCS = 60;
const TABLES_WITH_UPDATED_AT = new Set<ChangeTable>(["events", "submissions", "reviews", "judgeAccess", "normalizationDecisions"]);

type AnyDoc = Record<string, unknown>;

async function current(ctx: Pick<QueryCtx, "db">, table: ChangeTable, id: string) {
  const normalized = ctx.db.normalizeId(table, id);
  return normalized ? ((await ctx.db.get(normalized)) as AnyDoc | null) : null;
}

/** The documents and fields of a change that no longer hold the value it left. */
async function staleParts(ctx: Pick<QueryCtx, "db">, change: Doc<"eventChanges">) {
  const stale: { doc: ChangeDoc; fields: string[]; missing: boolean }[] = [];
  for (const doc of change.docs) {
    const now = await current(ctx, doc.table, doc.id);
    if (!now) {
      stale.push({ doc, fields: doc.fields.map((field) => field.name), missing: true });
      continue;
    }
    const fields = doc.fields.filter((field) => !deepEqual(now[field.name], field.after)).map((field) => field.name);
    if (fields.length > 0) stale.push({ doc, fields, missing: false });
  }
  return stale;
}

/** Why a change cannot be undone right now, or null when it can. */
async function undoBlocker(ctx: Pick<QueryCtx, "db">, event: Doc<"events">, change: Doc<"eventChanges">) {
  if (change.undoneAt !== undefined) return "This change was already undone.";
  if (change.undo === "none") return "This change can't be undone.";
  if (change.undo === "phase") {
    const phase = eventPhase(event);
    if (change.toPhase && phase !== change.toPhase) {
      return `The event has moved to ${PHASE_LABELS[phase]} since. Move it there from the phase switch instead.`;
    }
    return null;
  }
  const stale = await staleParts(ctx, change);
  if (stale.length === 0) return null;
  const later = await ctx.db.query("eventChanges").withIndex("by_event", (q) => q.eq("eventId", event._id)).order("desc").take(CONFLICT_SCAN);
  const touched = new Set(stale.flatMap((part) => part.fields.map((field) => `${part.doc.table}:${part.doc.id}:${field}`)));
  const blocker = later.find((row) =>
    row._creationTime > change._creationTime && row.undoneAt === undefined && row._id !== change._id &&
    row.docs.some((doc) => doc.fields.some((field) => touched.has(`${doc.table}:${doc.id}:${field.name}`))),
  );
  if (stale.some((part) => part.missing)) return "Something this change touched was deleted since, so it can't be undone.";
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

function inverse(doc: ChangeDoc): ChangeDoc {
  if (doc.op === "insert") return { ...doc, op: "delete", fields: doc.fields.map((field) => ({ name: field.name, before: field.after })) };
  return {
    ...doc,
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
    const latest = await ctx.db.get(event._id);
    await ctx.db.patch(event._id, { scoreBasisVersion: (latest?.scoreBasisVersion ?? 0) + 1, confirmedScoreBasisVersion: undefined, updatedAt: now });
    for (const decision of await ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200)) {
      await ctx.db.patch(decision._id, { stale: true, updatedAt: now });
    }
  }
  return change.docs.map(inverse);
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
  const rows = await ctx.db.query("eventChanges").withIndex("by_event", (q) => q.eq("eventId", event._id)).order("desc").take(limit + 1);
  const changes = await Promise.all(rows.slice(0, limit).map(async (row) => {
    const blocker = row.docs.length > LIST_CHECK_DOCS && row.undo === "snapshot" && row.undoneAt === undefined ? null : await undoBlocker(ctx, event, row);
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
  }));
  return { changes, hasMore: rows.length > limit };
}

export const listRecentChanges = query({
  args: listRecentChangesArgs,
  handler: async (ctx, args) => listRecentChangesForOrganization(ctx, args, await requireOrganization(ctx)),
});
