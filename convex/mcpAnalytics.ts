import type { CallToolResult, McpServer, ServerContext, StandardSchemaWithJSON, ToolAnnotations } from "@modelcontextprotocol/server";
import type { McpServer as ComponentServer, McpUser, ToolCtx, ToolDefinition } from "@convex-dev/mcp";
import { ConvexError, v, type GenericValidator, type PropertyValidators } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { trackMcpToolCall, type Actor, type McpToolCall } from "./analytics";
import { McpFailure } from "./mcpAuth";
import { CONTEXT_SCHEMA, withContext } from "./mcpSchema";
import { redactText } from "../lib/analytics-redact";

/**
 * One `$mcp_tool_call` per organiser MCP tool call on both servers. Arguments
 * and results are never sent; only the tool name, timing, an error code, a
 * fixed admin message and the agent's redacted `context`.
 */
type Scheduler = Pick<ActionCtx, "scheduler">;
type Failure = { type: NonNullable<McpToolCall["$mcp_error_type"]>; message?: string };
type Client = Pick<McpToolCall, "$session_id" | "$mcp_client_name" | "$mcp_client_version">;
type Call = { ctx: Scheduler; name: string; context?: string; actor: () => Actor | Promise<Actor>; client?: () => Client | Promise<Client> };

/** Thrown when a tool's arguments fail its schema. */
export class InvalidArguments extends Error { constructor() { super("Invalid tool arguments"); } }

const failures = new WeakMap<object, Failure>();
const organizationPattern = /^org_[A-Za-z0-9]+$/;

/** Classifies a tool failure. `message` is set only when the result carries one of the fixed admin messages. */
export function failureOf(error: unknown, message?: string): Failure {
  const data = error instanceof ConvexError && typeof error.data === "string" ? error.data.replace(/^"(.*)"$/, "$1") : undefined;
  const type = data === "Unauthorized" || (error instanceof McpFailure && ["invalid_token", "reauthorization_required", "membership_required"].includes(error.code)) ? "unauthorized"
    : error instanceof InvalidArguments || error instanceof z.ZodError || (error instanceof McpFailure && error.code === "invalid_request") ? "validation"
    : /not found/i.test(message ?? data ?? "") ? "not_found" : "operation_failed";
  return message ? { type, message: redactText(message) } : { type };
}

/** Records why a failed result failed, for its `$mcp_tool_call`. The result is returned unchanged. */
export function failed<Result extends object>(result: Result, failure: Failure): Result {
  failures.set(result, failure);
  return result;
}

async function report(call: Call, startedAt: number, failure?: Failure) {
  if (!process.env.POSTHOG_PROJECT_TOKEN?.trim()) return;
  try {
    const intent = call.context?.trim() ? redactText(call.context, 300) : undefined;
    await trackMcpToolCall(call.ctx, await call.actor(), {
      $mcp_tool_name: call.name, $mcp_is_error: failure !== undefined, $mcp_duration_ms: Date.now() - startedAt,
      ...(failure ? { $mcp_error_type: failure.type, ...(failure.message ? { $mcp_error_message: failure.message } : {}) } : {}),
      ...await call.client?.(),
      ...(intent ? { $mcp_intent: intent, $mcp_intent_source: "context_parameter" as const } : {}),
    }, startedAt);
  } catch {
    // Reporting never changes a tool's result.
  }
}

/** Runs one tool call and reports it once the handler returns or throws. */
export async function reportedCall<Result>(call: Call, run: () => Promise<Result>): Promise<Result> {
  const startedAt = Date.now();
  let result: Result;
  try { result = await run(); } catch (error) { await report(call, startedAt, failureOf(error)); throw error; }
  const failure = typeof result === "object" && result !== null
    ? failures.get(result) ?? ("isError" in result && result.isError === true ? { type: "operation_failed" as const } : undefined)
    : undefined;
  await report(call, startedAt, failure);
  return result;
}

async function sdkClient(server: McpServer, extra?: ServerContext): Promise<Client> {
  // Served statelessly, so 2025-era calls have neither a session nor the initialize handshake.
  const info = server.server.getClientVersion();
  const session = extra?.sessionId
    ? `ses_${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(extra.sessionId)))].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
    : undefined;
  return {
    ...(session ? { $session_id: session } : {}),
    ...(info ? { $mcp_client_name: redactText(info.name, 200), $mcp_client_version: redactText(info.version, 100) } : {}),
  };
}

export type RegisterTool = <Output>(
  name: string,
  config: { description: string; inputSchema: StandardSchemaWithJSON<unknown, Output>; annotations: ToolAnnotations },
  handler: (args: Output) => Promise<CallToolResult>,
) => void;

/** Registers SDK tools with the `context` argument and a `$mcp_tool_call` per call, including calls refused by validation. */
export function reportingRegistrar(server: McpServer, ctx: Scheduler, actor: Actor): RegisterTool {
  return (name, config, handler) => {
    const call = (context: string | undefined, extra?: ServerContext): Call => ({ ctx, name, context, actor: () => actor, client: () => sdkClient(server, extra) });
    server.registerTool(name, {
      ...config,
      inputSchema: withContext(config.inputSchema, (context) => report(call(context), Date.now(), { type: "validation" })),
    }, ({ args, context }, extra) => reportedCall(call(context, extra), () => handler(args)));
  };
}

type ComponentTool = ToolDefinition<PropertyValidators, GenericValidator | undefined, Id<"mcpApprovals">>;

async function componentActor(ctx: ToolCtx, user: McpUser<Id<"mcpApprovals">>, organizationId: unknown): Promise<Actor> {
  const approval = await ctx.runQuery(internal.mcpConnectionPolicy.getApproval, { approvalId: user.userId });
  if (!approval) return { kind: "system" };
  // list_organizations names no organization; an argument that is not an organization id is never sent.
  return { kind: "organiser", userId: approval.workosUserId, organizationId: typeof organizationId === "string" && organizationPattern.test(organizationId) ? organizationId : "", surface: "mcp" };
}

/** Adds the `context` argument and a `$mcp_tool_call` per call to every component tool. */
export function reportedComponentTools<Tools extends Record<string, ComponentTool>>(tools: Tools): Tools {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]): [string, ComponentTool] => [name, {
    ...tool,
    args: { ...tool.args, context: v.optional(v.string()) },
    handler: async (ctx, { context, ...args }, user) => reportedCall(
      { ctx, name, context: typeof context === "string" ? context : undefined, actor: () => componentActor(ctx, user, args.organizationId) },
      () => tool.handler(ctx, args, user),
    ),
  }])) as Tools;
}

/**
 * Convex validators carry no descriptions, so the component lists `context`
 * as a bare string; this puts the full schema into its compiled listings.
 */
export function describeContext<Server extends ComponentServer<Id<"mcpApprovals">>>(server: Server): Server {
  const { tools } = server as unknown as { tools?: unknown };
  if (!(tools instanceof Map)) return server;
  for (const tool of tools.values()) {
    const properties: unknown = tool?.listing?.inputSchema?.properties;
    if (typeof properties === "object" && properties !== null && "context" in properties) Object.assign(properties, { context: CONTEXT_SCHEMA });
  }
  return server;
}
