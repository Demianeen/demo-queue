import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

const connectUser = z.object({
  sub: z.string().regex(/^user_[A-Za-z0-9]+$/),
  sid: z.string().min(1),
  org_id: z.string().regex(/^org_[A-Za-z0-9]+$/),
  client_id: z.string().min(1),
  scope: z.string().refine((scope) => scope.split(" ").includes("openid")),
});

export type ConnectUser = Readonly<{ userId: string; organizationId: string; actor: string }>;
export type McpConfig = Readonly<{ issuer: string; resource: string; requestOrigin: string; apiKey: string }>;

export class McpFailure extends Error {
  constructor(readonly code: "invalid_token" | "reauthorization_required" | "membership_required" | "provider_unavailable" | "invalid_request" | "operation_failed") { super(code); }
}

export function mcpConfig(env: Record<string, string | undefined>): McpConfig {
  const issuer = new URL(env.WORKOS_MCP_ISSUER ?? "");
  const resource = new URL(env.WORKOS_MCP_RESOURCE ?? `${env.CONVEX_SITE_URL}/mcp`);
  const ingress = new URL(env.CONVEX_SITE_URL ?? resource.origin);
  if (issuer.protocol !== "https:" || issuer.pathname !== "/" || issuer.search || issuer.hash || issuer.username || issuer.password ||
      resource.protocol !== "https:" || resource.pathname !== "/mcp" || resource.search || resource.hash || resource.username || resource.password ||
      ingress.protocol !== "https:" || ingress.pathname !== "/" || ingress.search || ingress.hash || ingress.username || ingress.password || !env.WORKOS_API_KEY) {
    throw new McpFailure("provider_unavailable");
  }
  return { issuer: issuer.origin, resource: resource.href, requestOrigin: ingress.origin, apiKey: env.WORKOS_API_KEY };
}

export async function verifyConnectUser(token: string, config: McpConfig, key?: JWTVerifyGetKey): Promise<ConnectUser> {
  try {
    const { payload } = await jwtVerify(token, key ?? createRemoteJWKSet(new URL(`${config.issuer}/oauth2/jwks`)), {
      issuer: config.issuer, audience: config.resource, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "sid", "org_id"],
    });
    if (payload.aud !== config.resource) throw new McpFailure("invalid_token");
    const claims = connectUser.parse(payload);
    return { userId: claims.sub, organizationId: claims.org_id, actor: `${config.issuer}|${claims.sub}` };
  } catch { throw new McpFailure("invalid_token"); }
}

export const membershipCursor = z.string().min(1).max(4096);
const membershipPage = z.object({
  data: z.array(z.object({ user_id: z.string(), organization_id: z.string(), organization_name: z.string(), status: z.enum(["active", "inactive", "pending"]) })).max(100),
  list_metadata: z.object({ after: membershipCursor.nullable() }),
});
type MembershipPage = Readonly<{
  organizations: { id: string; name: string }[];
  selectedOrganizationId: string;
  nextCursor: z.infer<typeof membershipCursor> | null;
  hasMore: boolean;
}>;

async function fetchMembershipPage({ user, config, organizationId, cursor = null }: {
  user: ConnectUser; config: McpConfig; organizationId?: string; cursor?: string | null;
}): Promise<MembershipPage> {
  const url = new URL("https://api.workos.com/user_management/organization_memberships");
  url.searchParams.set("user_id", user.userId);
  url.searchParams.set("limit", "100");
  url.searchParams.append("statuses", "active");
  if (organizationId !== undefined) url.searchParams.set("organization_id", organizationId);
  if (cursor !== null) url.searchParams.set("after", cursor);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new McpFailure("provider_unavailable");
    const page = membershipPage.parse(await response.json());
    const organizations = page.data.filter((membership) => membership.status === "active" && membership.user_id === user.userId)
      .map((membership) => ({ id: membership.organization_id, name: membership.organization_name }));
    return { organizations, selectedOrganizationId: user.organizationId, nextCursor: page.list_metadata.after, hasMore: page.list_metadata.after !== null };
  } catch (error) {
    if (error instanceof McpFailure) throw error;
    throw new McpFailure("provider_unavailable");
  }
}

export async function activeMemberships(user: ConnectUser, config: McpConfig) {
  const page = await fetchMembershipPage({ user, config, organizationId: user.organizationId });
  if (!page.organizations.some((organization) => organization.id === user.organizationId)) throw new McpFailure("membership_required");
  return page;
}

export async function listActiveMemberships({ user, config, cursor }: { user: ConnectUser; config: McpConfig; cursor: string | null }) {
  await activeMemberships(user, config);
  return fetchMembershipPage({ user, config, cursor });
}

export function requireSelectedOrganization(user: ConnectUser, organizationId: string) {
  if (organizationId !== user.organizationId) throw new McpFailure("reauthorization_required");
}
