import { v, type Infer } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { OrganizationPrincipal } from "./organizationAuth";
import { eventPhase, type EventPhase } from "../lib/event-phase";

/**
 * The organiser change log behind Recent changes and Undo. An undoable patch
 * keeps the before and after value of every field it changed, per document,
 * so it can be reversed later, and so a reversal can tell when a later change
 * touched the same fields.
 *
 * What it never keeps: the documents of a change that can't be undone, the
 * fields of an inserted or deleted document (a delete is never undone, and
 * undoing an insert deletes it by id), and the value of a secret field, which
 * is kept as a sha256 marker so the conflict check can still compare it.
 * Rows are deleted after CHANGE_RETENTION_MS.
 */

/** Tables a change may touch and that undo knows how to restore. */
export const CHANGE_TABLES = ["events", "submissions", "teamMembers", "reviews", "judgeAccess", "normalizationDecisions"] as const;
export type ChangeTable = (typeof CHANGE_TABLES)[number];
const changeTableValidator = v.union(...CHANGE_TABLES.map((table) => v.literal(table)));

/**
 * Fields that never take part: bookkeeping, counters that must only grow, and
 * values written in the background (sheet sync, AI summaries, emails).
 */
const IGNORED_FIELDS = new Set([
  "_id", "_creationTime", "updatedAt",
  "judgingSheetSyncRevision", "judgingSheetSyncedRevision", "judgingSheetSyncedAt", "judgingSheetSyncError",
  "scoreBasisVersion", "confirmedScoreBasisVersion", "assignmentVersion",
  "lastAdvanceSnapshot", "statusLinkEmailedAt", "aiSummary", "submissionSurgeAt",
]);

/**
 * Tables where every write sets updatedAt, so it works as a version. Not
 * events: each submit touches the event, which would block every undo.
 */
export const VERSIONED_TABLES: ReadonlySet<ChangeTable> = new Set(["submissions", "reviews", "judgeAccess", "normalizationDecisions"]);

/** The version a document of this table has now, or undefined. */
export function docVersion(table: ChangeTable, doc: Record<string, unknown> | null | undefined) {
  return VERSIONED_TABLES.has(table) && typeof doc?.updatedAt === "number" ? doc.updatedAt : undefined;
}

/** Proposed: 30 days, long enough to undo anything from an event night. */
export const CHANGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fields holding a private link or capability token, per table. Never stored
 * in clear. The retired event admin token is never written any more, so no
 * diff can hold it, and inserts and deletes keep no fields.
 */
export const SECRET_FIELDS: Partial<Record<ChangeTable, ReadonlySet<string>>> = {
  submissions: new Set(["participantToken"]),
  judgeAccess: new Set(["token"]),
};

/** Undoing a change that replaced a secret would need its old value, which is not kept. */
export const SECRET_NOT_UNDOABLE = "A replaced link can't be brought back.";

export function isSecretField(table: ChangeTable, name: string) {
  return SECRET_FIELDS[table]?.has(name) ?? false;
}

export type HashedValue = { hashed: string };

export function isHashedValue(value: unknown): value is HashedValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 && typeof (value as HashedValue).hashed === "string";
}

export async function hashSecret(value: unknown): Promise<HashedValue> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { hashed: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

/** Whether a document's current value still matches a stored one, hashed or not. */
export async function storedValueMatches(table: ChangeTable, name: string, current: unknown, stored: unknown) {
  if (isSecretField(table, name) && isHashedValue(stored)) {
    return current !== undefined && (await hashSecret(current)).hashed === stored.hashed;
  }
  return deepEqual(current, stored);
}

export const changeFieldValidator = v.object({
  name: v.string(),
  before: v.optional(v.any()),
  after: v.optional(v.any()),
});
export const changeDocValidator = v.object({
  table: changeTableValidator,
  id: v.string(),
  op: v.union(v.literal("patch"), v.literal("insert"), v.literal("delete")),
  fields: v.array(changeFieldValidator),
  // The document's updatedAt after the change, for tables where every write
  // sets it. Undo compares it, so a later write that was never logged (a
  // participant edit, a judge's score) still blocks the undo.
  version: v.optional(v.number()),
});
export type ChangeDoc = Infer<typeof changeDocValidator>;

export const undoKindValidator = v.union(v.literal("snapshot"), v.literal("phase"), v.literal("none"));
export const undoLabelValidator = v.union(v.literal("Undo"), v.literal("Restore"), v.literal("Reopen"));
export type UndoLabel = Infer<typeof undoLabelValidator>;

/** Large changes are listed but not stored for undo, to stay well inside the document size limit. */
const MAX_STORED_CHANGE_BYTES = 600_000;
const MAX_STORED_DOCS = 2_000;

type Scope<T extends TableNames> = "all" | Id<T>[];
export type ChangeWatch = {
  submissions?: Scope<"submissions">;
  /** "all", or the team members of these submissions. */
  teamMembers?: "all" | Id<"submissions">[];
  reviews?: "all";
  judgeAccess?: "all";
  normalizationDecisions?: "all";
};

export type ChangeInput = {
  event: Doc<"events">;
  principal: Pick<OrganizationPrincipal, "actor" | "mcp">;
  /** Set for a change the team made from their status page. */
  byParticipant?: boolean;
  kind: string;
  summary: string;
  subjectId?: string;
  undoLabel?: UndoLabel;
  /** "phase" reverses by moving back to fromPhase; "none" lists the change without undo. */
  undo?: "snapshot" | "phase" | "none";
  /** Shown instead of "This change can't be undone." when undo is "none". */
  noUndoReason?: string;
  fromPhase?: EventPhase;
  toPhase?: EventPhase;
  watch?: ChangeWatch;
};

/** The WorkOS user id inside an actor string ("<issuer>|user_..."), when there is one. */
export function actorUserId(actor: string) {
  const match = /\|(user_[A-Za-z0-9]+)$/.exec(actor);
  return match ? match[1] : undefined;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (typeof left === "object") {
    if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) return false;
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!deepEqual(a[key], b[key])) return false;
    return true;
  }
  return false;
}

type AnyDoc = Record<string, unknown> & { _id: string };

async function readScope(ctx: Pick<QueryCtx, "db">, event: Doc<"events">, watch: ChangeWatch) {
  const docs = new Map<string, { table: ChangeTable; doc: AnyDoc | null }>();
  const put = (table: ChangeTable, doc: AnyDoc) => docs.set(`${table}:${doc._id}`, { table, doc });
  const eventDoc = await ctx.db.get(event._id);
  if (eventDoc) put("events", eventDoc as unknown as AnyDoc);
  if (watch.submissions === "all") {
    for (const row of await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000)) put("submissions", row as unknown as AnyDoc);
  } else {
    for (const id of watch.submissions ?? []) {
      const row = await ctx.db.get(id);
      if (row) put("submissions", row as unknown as AnyDoc);
      else docs.set(`submissions:${id}`, { table: "submissions", doc: null });
    }
  }
  if (watch.teamMembers === "all") {
    for (const row of await ctx.db.query("teamMembers").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(5000)) put("teamMembers", row as unknown as AnyDoc);
  } else {
    for (const submissionId of watch.teamMembers ?? []) {
      for (const row of await ctx.db.query("teamMembers").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).take(50)) put("teamMembers", row as unknown as AnyDoc);
    }
  }
  if (watch.reviews === "all") {
    for (const row of await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(4000)) put("reviews", row as unknown as AnyDoc);
  }
  if (watch.judgeAccess === "all") {
    for (const row of await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200)) put("judgeAccess", row as unknown as AnyDoc);
  }
  if (watch.normalizationDecisions === "all") {
    for (const row of await ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200)) put("normalizationDecisions", row as unknown as AnyDoc);
  }
  return docs;
}

async function diffDoc(table: ChangeTable, before: AnyDoc | null, after: AnyDoc | null): Promise<ChangeDoc | null> {
  if (!before && !after) return null;
  const id = (before ?? after)!._id;
  const version = docVersion(table, after);
  const versioned = version !== undefined ? { version } : {};
  // Inserts and deletes keep no field values: only the id and the op.
  if (!before) return { table, id, op: "insert", fields: [], ...versioned };
  if (!after) return { table, id, op: "delete", fields: [] };
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const fields: ChangeDoc["fields"] = [];
  for (const name of keys) {
    if (IGNORED_FIELDS.has(name)) continue;
    const from = before?.[name];
    const to = after?.[name];
    if (deepEqual(from, to)) continue;
    const secret = isSecretField(table, name);
    const kept = async (value: unknown) => (secret ? await hashSecret(value) : value);
    fields.push({ name, ...(from !== undefined ? { before: await kept(from) } : {}), ...(to !== undefined ? { after: await kept(to) } : {}) });
  }
  if (fields.length === 0) return null;
  return { table, id, op: "patch", fields, ...versioned };
}

/** Compares two reads of the same scope. Documents found only after are inserts. */
async function diffScopes(
  before: Awaited<ReturnType<typeof readScope>>,
  after: Awaited<ReturnType<typeof readScope>>,
) {
  const changes: ChangeDoc[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const table = (before.get(key) ?? after.get(key))!.table;
    const change = await diffDoc(table, before.get(key)?.doc ?? null, after.get(key)?.doc ?? null);
    if (change) changes.push(change);
  }
  return changes;
}

export async function insertChange(
  ctx: MutationCtx,
  input: ChangeInput,
  docs: ChangeDoc[],
  extra: { undoOf?: Id<"eventChanges"> } = {},
) {
  let undo = input.undo ?? "snapshot";
  let noUndoReason = input.noUndoReason;
  let stored = docs;
  if (undo === "snapshot") {
    if (docs.length === 0 || docs.some((doc) => doc.op === "delete")) undo = "none";
    else if (docs.some((doc) => doc.fields.some((field) => isSecretField(doc.table, field.name) && field.before !== undefined))) {
      undo = "none";
      noUndoReason ??= SECRET_NOT_UNDOABLE;
    } else if (docs.length > MAX_STORED_DOCS || JSON.stringify(docs).length > MAX_STORED_CHANGE_BYTES) undo = "none";
  }
  // A change that can't be undone keeps no documents.
  if (undo === "none") stored = [];
  else if (JSON.stringify(stored).length > MAX_STORED_CHANGE_BYTES) stored = [];
  return await ctx.db.insert("eventChanges", {
    eventId: input.event._id,
    actor: input.principal.actor,
    actorUserId: actorUserId(input.principal.actor),
    via: input.byParticipant ? "participant" : input.principal.mcp ? "assistant" : "app",
    kind: input.kind,
    summary: input.summary,
    subjectId: input.subjectId,
    undo,
    undoLabel: input.undoLabel ?? "Undo",
    ...(undo === "none" && noUndoReason ? { noUndoReason } : {}),
    fromPhase: input.fromPhase,
    toPhase: input.toPhase,
    ...(undo === "snapshot" ? { phaseAtChange: eventPhase(input.event) } : {}),
    docs: stored,
    undoOf: extra.undoOf,
    createdAt: Date.now(),
  });
}

/**
 * Runs an organiser change and records it. The event document is always
 * compared; `watch` names the other documents the change may touch. A change
 * that touches nothing is not recorded.
 */
export async function recordChange<T>(ctx: MutationCtx, input: ChangeInput, run: () => Promise<T>): Promise<T> {
  const watch = input.watch ?? {};
  const before = await readScope(ctx, input.event, watch);
  const result = await run();
  const after = await readScope(ctx, input.event, watch);
  const docs = await diffScopes(before, after);
  if (docs.length > 0 || input.undo === "phase") await insertChange(ctx, input, docs);
  return result;
}

export function changeSummaryName(submission: Pick<Doc<"submissions">, "demoTitle" | "teamName" | "name"> | null | undefined) {
  if (!submission) return "a submission";
  return submission.demoTitle || submission.teamName || submission.name;
}
