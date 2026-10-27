import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Sends a participant their private status link. Email delivery is not set
 * up yet, so this only records that a send was skipped. It never logs the
 * address or the link.
 */
export const sendStatusLinkEmail = internalAction({
  args: {
    submissionId: v.id("submissions"),
    to: v.string(),
    reason: v.union(v.literal("submitted"), v.literal("resend")),
  },
  handler: async (_ctx, args) => {
    console.info("status-link-email", { submissionId: args.submissionId, reason: args.reason, status: "skipped", why: "email sending is not set up" });
    return { sent: false };
  },
});
