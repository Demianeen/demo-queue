import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";

export async function requireOrganization(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to manage events.");
  const organizationId = identity.org_id;
  if (typeof organizationId !== "string" || !organizationId.startsWith("org_")) {
    throw new ConvexError("Choose an organization to manage events.");
  }
  return { organizationId, actor: identity.tokenIdentifier };
}
