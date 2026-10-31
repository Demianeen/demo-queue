import { createMcpHandler, isLegacyRequest, McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { activeMemberships, listActiveMemberships, membershipCursor, mcpConfig, McpFailure, requireSelectedOrganization, verifyConnectUser, type ConnectUser, type McpConfig } from "./mcpAuth";
import { VISUAL_STYLES } from "../lib/visual-style";
import { registerAdminTools } from "./mcpTools";
import { ConvexError } from "convex/values";

const MAX_BODY = 262144;
const organizationId = z.string().regex(/^org_[A-Za-z0-9]+$/);
const styleSelection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(VISUAL_STYLES) }).strict(),
  z.object({ kind: z.literal("saved"), id: z.string().min(1).max(128) }).strict(),
]);
const defaultSelection = z.discriminatedUnion("kind", [...styleSelection.options, z.object({ kind: z.literal("none") }).strict()]);
const theme = z.object({
  background: z.string().regex(/^#[0-9a-f]{6}$/i), foreground: z.string().regex(/^#[0-9a-f]{6}$/i), accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  font: z.enum(["sans", "serif", "mono"]), radius: z.number().int().min(0).max(24),
}).strict();

function result(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }; }

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

async function toolCall(user: ConnectUser, config: McpConfig, expectedOrganizationId: string, operation: () => Promise<unknown>, adminOperation = false) {
  try {
    requireSelectedOrganization(user, expectedOrganizationId);
    await activeMemberships(user, config);
    return result(await operation());
  } catch (error) {
    if (adminOperation && error instanceof ConvexError) {
      const matches = (message: string) => error.data === message || error.data === JSON.stringify(message);
      if (matches("Unauthorized")) return { ...result({ error: "access_denied" }), isError: true };
      const message = [...adminMessages].find(matches);
      if (message) {
        return { ...result({ error: "invalid_operation", message }), isError: true };
      }
    }
    return { ...result({ error: error instanceof McpFailure ? error.code : "operation_failed" }), isError: true };
  }
}

export function createToolServer(ctx: Pick<ActionCtx, "runQuery" | "runMutation" | "runAction">, user: ConnectUser, config: McpConfig) {
  const server = new McpServer({ name: "demo-queue", version: "1.0.0" });
  server.registerTool("list_organizations", {
    description: "List active memberships. Acting in another organization requires OAuth reauthorization.",
    inputSchema: z.object({ cursor: membershipCursor.nullable().default(null) }).strict(), annotations: { readOnlyHint: true },
  }, async ({ cursor }) => {
    try { return result(await listActiveMemberships({ user, config, cursor })); }
    catch (error) { return { ...result({ error: error instanceof McpFailure ? error.code : "provider_unavailable" }), isError: true }; }
  });
  server.registerTool("list_events", {
    description: "List safe event metadata in the OAuth-selected organization.",
    inputSchema: z.object({ organizationId, limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(4096).nullable().default(null) }).strict(), annotations: { readOnlyHint: true },
  }, async (args) => toolCall(user, config, args.organizationId, () => ctx.runQuery(internal.mcpData.listEvents, { organizationId: args.organizationId, paginationOpts: { numItems: args.limit, cursor: args.cursor } })));
  server.registerTool("get_event", {
    description: "Read safe event metadata. Capabilities, contacts, and judging records are excluded.",
    inputSchema: z.object({ organizationId, slug: z.string().min(1).max(200) }).strict(), annotations: { readOnlyHint: true },
  }, async (args) => toolCall(user, config, args.organizationId, () => ctx.runQuery(internal.mcpData.getEvent, args)));
  server.registerTool("create_event", {
    description: "Create an initially unpublished event using a saved style, built-in preset, or the organization default.",
    inputSchema: z.object({ organizationId, name: z.string().trim().min(1).max(160), slug: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), eventType: z.enum(["demo", "hackathon"]), meetUrl: z.url().max(2048).refine((url) => ["https:", "http:"].includes(new URL(url).protocol)).optional().describe("Google Meet link. Required for a demo night; optional for a hackathon."), style: styleSelection.optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => toolCall(user, config, args.organizationId, () => ctx.runMutation(internal.mcpData.createEvent, {
    expectedOrganizationId: args.organizationId, actor: user.actor, name: args.name, slug: args.slug, eventType: args.eventType, meetUrl: args.meetUrl,
    ...(args.style?.kind === "saved" ? { styleId: args.style.id } : args.style?.kind === "preset" ? { visualStyle: args.style.preset } : {}),
  })));
  server.registerTool("list_styles", {
    description: "List built-in presets and saved structured styles.", inputSchema: z.object({ organizationId }).strict(), annotations: { readOnlyHint: true },
  }, async (args) => toolCall(user, config, args.organizationId, () => ctx.runQuery(internal.mcpData.listStyles, args)));
  server.registerTool("create_style", {
    description: "Create a new nondefault structured style. Existing styles are never updated.",
    inputSchema: z.object({ organizationId, name: z.string().trim().min(1).max(80), theme }).strict(), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => toolCall(user, config, args.organizationId, () => ctx.runMutation(internal.mcpData.createStyle, args)));
  server.registerTool("set_default_style", {
    description: "Explicitly change the organization default, or remove it with kind \"none\" (New event then asks for a style; create_event without a style uses Base). Existing event snapshots remain unchanged.",
    inputSchema: z.object({ organizationId, selection: defaultSelection }).strict(), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (args) => toolCall(user, config, args.organizationId, () => ctx.runMutation(internal.mcpData.setDefaultStyle, args)));
  registerAdminTools(server, ctx, user, (organizationId, operation) => toolCall(user, config, organizationId, operation, true));
  return server;
}

export async function serveMcp(request: Request, factory: () => McpServer) {
  // The SDK's built-in legacy fallback always streams, so compose its JSON transport.
  if (await isLegacyRequest(request, undefined, { maxRequestBodySize: MAX_BODY })) {
    const server = factory();
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY });
    try { await server.connect(transport); return await transport.handleRequest(request); }
    finally { await transport.close(); await server.close(); }
  }
  const handler = createMcpHandler(factory, { legacy: "reject", responseMode: "json", maxRequestBodySize: MAX_BODY, maxSubscriptions: 0, keepAliveMs: 0 });
  try { return await handler.fetch(request); } finally { await handler.close(); }
}

function boundaryResponse(status: number, error: string, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function validResourceRequest(request: Request, config: McpConfig) {
  const url = new URL(request.url);
  const resource = new URL(config.resource);
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  return url.origin === config.requestOrigin && !url.search && (host === null || host === url.host) && (origin === null || origin === resource.origin);
}

export const mcp = httpAction(async (ctx, request) => {
  let config: McpConfig;
  try { config = mcpConfig(process.env); } catch { return boundaryResponse(503, "unavailable"); }
  if (!validResourceRequest(request, config)) return boundaryResponse(403, "invalid_request");
  if (request.method !== "POST") return boundaryResponse(405, "method_not_allowed", { Allow: "POST" });
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  const challenge = { "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", config.resource)}"` };
  if (!bearer) return boundaryResponse(401, "invalid_token", challenge);
  let user: ConnectUser;
  try { user = await verifyConnectUser(bearer, config); }
  catch { return boundaryResponse(401, "invalid_token", challenge); }
  try {
    const response = await serveMcp(request, () => createToolServer(ctx, user, config));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return boundaryResponse(400, "invalid_request"); }
});

export const metadata = httpAction(async (_ctx, request) => {
  let config: McpConfig;
  try { config = mcpConfig(process.env); } catch { return boundaryResponse(503, "unavailable"); }
  if (!validResourceRequest(request, config)) return boundaryResponse(403, "invalid_request");
  return Response.json({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: ["openid", "profile", "email", "offline_access"], bearer_methods_supported: ["header"] }, { headers: { "Cache-Control": "no-store" } });
});
