import { callToolResult, type McpUser, type ToolCtx } from "@convex-dev/mcp";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { OrganizationPrincipal } from "./organizationAuth";
import { currentMemberships, type McpScope } from "./mcpConnectionPolicy";

const adminMessages = new Set([
  "Submissions are closed.", "Judging is only available for hackathon events.",
  "Judging sheets are only available for hackathon events.", "Close submissions first.",
  "Assignments can only be prepared before judging starts.", "Add at least 2 judges first.",
  "Assignment preparation is not active.", "Assignments are not ready.",
  "Judging is not open.", "Judging is not closed.", "Close judging first.",
  "Add another available judge before redistributing reviews.", "Invalid judge assignment.",
  "Redistribution must include every unfinished assignment in the preview.",
  "Redistribution must keep the other assigned judge.",
  "This judge has no complete reviews to normalize.",
  "Add this judge to the event before creating their link.", "Judge not found.",
  "Create the judging sheet before syncing it.", "Submission not found",
  "Submission does not belong to this event.", "Add between 1 and 25 test submissions at a time.",
  "Event type cannot change after judging has started.",
  "Confirmation must match the event.", "Confirmation must match the event and type.",
  "Add hackathon teams through the public submission form.",
  "Publish the queue before showing the Meet link in the presentation view",
]);

export function toolFailure(error: unknown) {
  let value: { error: string; message?: string } = { error: "operation_failed" };
  if (error instanceof ConvexError) {
    const matches = (message: string) => error.data === message || error.data === JSON.stringify(message);
    if (matches("Unauthorized")) value = { error: "access_denied" };
    else if (matches("Membership verification is unavailable.")) value = { error: "provider_unavailable" };
    else {
      const message = [...adminMessages].find(matches);
      if (message) value = { error: "invalid_operation", message };
    }
  }
  return callToolResult({ content: [{ type: "text", text: JSON.stringify(value) }], isError: true });
}

export async function componentToolCall(ctx: ToolCtx, user: McpUser<Id<"mcpApprovals">>, organizationId: string, scope: McpScope, operation: (principal: OrganizationPrincipal) => Promise<unknown>) {
  try {
    const principal = await ctx.runQuery(internal.mcpConnectionPolicy.getPrincipal, { user, organizationId, scope });
    const approval = await ctx.runQuery(internal.mcpConnectionPolicy.getApproval, { approvalId: user.userId });
    if (!approval) throw new ConvexError("Unauthorized");
    const memberships = await currentMemberships(approval.workosUserId);
    if (!memberships.some((organization) => organization.id === organizationId)) throw new ConvexError("Unauthorized");
    return await operation(principal);
  } catch (error) { return toolFailure(error); }
}
