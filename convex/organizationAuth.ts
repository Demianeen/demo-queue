import { ConvexError, v, type Infer } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { findEventBySlug } from "./eventSlugs";

export const organizationPrincipalValidator = v.object({
  organizationId: v.string(),
  actor: v.string(),
});
export type OrganizationPrincipal = Infer<typeof organizationPrincipalValidator>;

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
  return requireOwnedEvent(ctx, slug, await requireOrganization(ctx));
}

export async function requireOwnedEvent(
  ctx: Pick<QueryCtx, "db">,
  slug: string,
  { organizationId, actor }: OrganizationPrincipal,
) {
  const event = await findEventBySlug(ctx, slug);
  if (!event || event.workosOrganizationId !== organizationId) throw new ConvexError("Unauthorized");
  return { event, actor };
}
