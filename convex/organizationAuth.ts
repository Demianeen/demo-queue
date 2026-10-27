import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { findEventBySlug } from "./eventSlugs";

export async function requireOrganization(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to manage events.");
  const organizationId = identity.org_id;
  if (typeof organizationId !== "string" || !organizationId.startsWith("org_")) {
    throw new ConvexError("Choose an organization to manage events.");
  }
  return { organizationId, actor: identity.tokenIdentifier };
}

export async function requireEventOrganization(ctx: Pick<QueryCtx, "auth" | "db">, slug: string) {
  const { organizationId, actor } = await requireOrganization(ctx);
  const event = await findEventBySlug(ctx, slug);
  if (!event || event.workosOrganizationId !== organizationId) throw new ConvexError("Unauthorized");
  return { event, actor };
}
