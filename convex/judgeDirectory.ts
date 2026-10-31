import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { judgeKeyOf, judgeNameKey } from "../lib/judging-assignment";

/**
 * Who the judges of an event are. A judge is their key: made once when they
 * are added and never worked out from their name again. Their name is only a
 * label, kept in one place, their judgeAccess row. See docs/judge-identity.md.
 *
 * The roster (event.roundOneJudges) and every assignment hold judge keys.
 * Events set up before judges had ids hold the judges' names there instead,
 * and a judge with no link yet has no judgeAccess row, so their name is the
 * roster entry itself. judgeKeyOf reads both shapes, so nothing is migrated.
 */
export type EventJudge = {
  key: string;
  name: string;
  onRoster: boolean;
  access: Doc<"judgeAccess"> | null;
};

export type JudgeDirectory = ReturnType<typeof judgeDirectory>;

export function judgeDirectory(event: Pick<Doc<"events">, "roundOneJudges">, links: Doc<"judgeAccess">[]) {
  const linkByKey = new Map(links.map((link) => [link.judgeKey, link]));
  const judges: EventJudge[] = [];
  const byKey = new Map<string, EventJudge>();
  for (const reference of event.roundOneJudges ?? []) {
    const key = judgeKeyOf(reference);
    if (byKey.has(key)) continue;
    const access = linkByKey.get(key) ?? null;
    const judge = { key, name: access?.judgeName ?? reference, onRoster: true, access };
    judges.push(judge);
    byKey.set(key, judge);
  }
  // A link left from a judge who is no longer on the roster.
  for (const link of links) {
    if (byKey.has(link.judgeKey)) continue;
    const judge = { key: link.judgeKey, name: link.judgeName, onRoster: false, access: link };
    judges.push(judge);
    byKey.set(link.judgeKey, judge);
  }
  return {
    /** Roster judges in roster order, then judges who only have a link. */
    judges,
    roster: judges.filter((judge) => judge.onRoster),
    /** The judge a stored reference (a key, or an old name entry) stands for. */
    get: (reference: string) => byKey.get(judgeKeyOf(reference)),
    /** The name to show for a stored reference. */
    nameOf: (reference: string) => byKey.get(judgeKeyOf(reference))?.name ?? reference,
    /**
     * The judge with this name now, for input that only has a name: a typed
     * or pasted name, or an assistant naming a judge. Never for stored data.
     */
    byName: (name: string) => {
      const wanted = judgeNameKey(name);
      return judges.find((judge) => judge.onRoster && judgeNameKey(judge.name) === wanted) ??
        judges.find((judge) => judgeNameKey(judge.name) === wanted);
    },
  };
}

export async function loadJudgeDirectory(ctx: QueryCtx | MutationCtx, event: Doc<"events">) {
  const links = await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200);
  return judgeDirectory(event, links);
}

/** A new judge key: random, so it never looks like, or comes from, a name. */
export function newJudgeKey(taken: ReadonlySet<string>) {
  for (;;) {
    const key = `j_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    if (!taken.has(key)) return key;
  }
}
