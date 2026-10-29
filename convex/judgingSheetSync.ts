import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const JUDGING_SHEET_SYNC_DEBOUNCE_MS = 2_000;

export async function queueJudgingSheetSync(
  ctx: MutationCtx,
  event: Doc<"events">,
  delayMs = JUDGING_SHEET_SYNC_DEBOUNCE_MS,
) {
  if ((event.eventType ?? "demo") !== "hackathon" || !event.judgingSheetId) return null;

  const revision = (event.judgingSheetSyncRevision ?? 0) + 1;
  await ctx.db.patch(event._id, {
    judgingSheetSyncRevision: revision,
    judgingSheetSyncError: undefined,
  });
  await ctx.scheduler.runAfter(delayMs, internal.googleSheets.syncJudgingSheet, {
    eventId: event._id,
    revision,
  });
  return revision;
}
