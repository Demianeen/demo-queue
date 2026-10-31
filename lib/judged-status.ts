/**
 * The submission statuses that count as a judged project on a hackathon.
 *
 * The finalists pitch through the stage queue: they are "queued" in the
 * lineup, and Next marks the presenter "done" (or "no_show"). A project that
 * pitched is still a judged project, so totals, progress, ranking, the
 * finalists and the winners keep it after its pitch. "up_next" and "current"
 * are older lineup statuses, kept for the same reason. Only hidden and
 * withdrawn projects are out of judging.
 *
 * Judging runs only on hackathons, so a demo night never reads this.
 */
const JUDGED_STATUSES: ReadonlySet<string> = new Set(["candidate", "queued", "up_next", "current", "done", "no_show"]);

export function isJudgedStatus(status: string) {
  return JUDGED_STATUSES.has(status);
}
