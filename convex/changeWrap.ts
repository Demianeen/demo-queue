import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireOwnedEvent, type OrganizationPrincipal } from "./organizationAuth";
import { recordChange, type ChangeInput } from "./changeLog";

export type ChangeDescription = Omit<ChangeInput, "event" | "principal">;

/**
 * Wraps an organiser operation so the change it makes is recorded for
 * Recent changes and Undo. The browser mutation and the MCP tool both call
 * the wrapped operation, so both are recorded the same way.
 */
export function withChange<Args extends { slug: string }, Result>(
  describe: (ctx: MutationCtx, args: Args, event: Doc<"events">) => ChangeDescription | Promise<ChangeDescription>,
  operation: (ctx: MutationCtx, args: Args, principal: OrganizationPrincipal) => Promise<Result>,
) {
  return async (ctx: MutationCtx, args: Args, principal: OrganizationPrincipal): Promise<Result> => {
    const { event } = await requireOwnedEvent(ctx, args.slug, principal);
    const description = await describe(ctx, args, event);
    return recordChange(ctx, { ...description, event, principal }, () => operation(ctx, args, principal));
  };
}

/** The title a change names a submission by, read before the change runs. */
export async function submissionTitle(ctx: MutationCtx, event: Doc<"events">, id: Doc<"submissions">["_id"]) {
  const submission = await ctx.db.get(id);
  if (!submission || submission.eventId !== event._id) return "a submission";
  return submission.demoTitle || submission.teamName || submission.name;
}

/** "2 minutes", "30 seconds". */
export function amountOfTime(ms: number) {
  const abs = Math.abs(ms);
  if (abs >= 60_000 && abs % 60_000 === 0) {
    const minutes = abs / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.round(abs / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
