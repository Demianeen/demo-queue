import { convexTest } from "convex-test";
import component from "@convex-dev/mcp/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { z } from "zod";
import { api } from "./_generated/api";
import schema from "./schema";
import { CONTEXT_SCHEMA } from "./mcpSchema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./convex.config.ts"]);
const sdkModules = {
  ...modules,
  "./http.ts": async () => {
    const { httpRouter } = await import("convex/server");
    const { mcp } = await import("./mcpWorkos");
    const http = httpRouter();
    http.route({ path: "/mcp", method: "POST", handler: mcp });
    return { default: http };
  },
};
const site = "https://precious-elk-564.convex.site";
const issuer = "https://login.example.com";
const sdkResource = "https://some.convex.site/mcp";
const context = "Setting up the night for alice@example.com, who asked on +44 7700 900123";
const event = z.object({ event: z.string(), distinct_id: z.string(), properties: z.record(z.string(), z.unknown()) });
const toolList = z.object({ result: z.object({ tools: z.array(z.object({ name: z.string(), inputSchema: z.object({ properties: z.record(z.string(), z.unknown()), required: z.array(z.string()).optional() }).passthrough() })) }) });
const toolResult = z.object({ result: z.object({ content: z.array(z.object({ text: z.string() })), isError: z.boolean().optional() }) });

let privateKey: CryptoKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let posted: string[] = [];
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
});
beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("WORKOS_MCP_ISSUER", issuer);
  vi.stubEnv("WORKOS_API_KEY", "private-provider-key");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  vi.stubGlobal("fetch", vi.fn(async (input: URL | Request | string, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === "https://eu.i.posthog.com") { posted.push(String(init?.body)); return Response.json({ status: 1 }); }
    if (url.href === `${issuer}/oauth2/jwks`) return Response.json({ keys: [publicJwk] });
    if (url.origin !== "https://api.workos.com") throw new Error("Unexpected external provider");
    const user = url.searchParams.get("user_id") ?? "";
    const rows = ["org_one", "org_two"].map((id) => ({ user_id: user, organization_id: id, organization_name: id, status: "active" }));
    const selected = url.searchParams.get("organization_id");
    return Response.json({ data: selected ? rows.filter((row) => row.organization_id === selected) : rows, list_metadata: { after: null } });
  }));
});
afterEach(() => { vi.clearAllTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

type Test = ReturnType<typeof convexTest>;
async function rpc(t: Test, bearer: string, method: string, params: unknown, version = "2025-06-18") {
  const response = await t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": version }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  expect(response.status).toBe(200);
  return response.json();
}
async function call(t: Test, bearer: string, name: string, args: Record<string, unknown>) {
  return toolResult.parse(await rpc(t, bearer, "tools/call", { name, arguments: args })).result;
}
async function sent(t: Test) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // Tools also send their own product events, such as event_created.
  return posted.flatMap((body) => z.object({ batch: z.array(event) }).parse(JSON.parse(body)).batch).filter((row) => row.event === "$mcp_tool_call");
}
function expectContextArgument(tools: z.infer<typeof toolList>["result"]["tools"]) {
  expect(tools.length).toBeGreaterThan(80);
  for (const tool of tools) {
    expect(tool.inputSchema.properties.context, tool.name).toEqual(CONTEXT_SCHEMA);
    expect(tool.inputSchema.required ?? [], tool.name).not.toContain("context");
  }
}
/** No argument value reaches a posted `$mcp_tool_call`. Product events such as event_created carry their own agreed properties. */
function expectPrivate(events: z.infer<typeof event>[], ...values: string[]) {
  const body = JSON.stringify(events);
  expect(events.length).toBeGreaterThan(0);
  for (const value of [...values, "alice@example.com", "7700 900123", "$mcp_parameters", "$mcp_response"]) expect(body).not.toContain(value);
}

function sdkServer() {
  vi.stubEnv("WORKOS_MCP_RESOURCE", sdkResource);
  return convexTest(schema, sdkModules);
}
async function sdkToken() {
  return new SignJWT({ iss: issuer, aud: sdkResource, sub: "user_operator", sid: "consent", org_id: "org_one", client_id: "client_test", scope: "openid", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey);
}

test("the SDK server reports one $mcp_tool_call per call without arguments, with the context redacted and kept from the tool", async () => {
  const t = sdkServer();
  const bearer = await sdkToken();
  await rpc(t, bearer, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } });
  expectContextArgument(toolList.parse(await rpc(t, bearer, "tools/list", {})).result.tools);
  posted = [];
  // Every tool schema is strict, so success means `context` never reached validation or the handler.
  const created = await call(t, bearer, "create_event", { organizationId: "org_one", name: "Secret Team Rocket", slug: "rocket-night", eventType: "demo", meetUrl: "https://meet.example.com/room", context });
  expect(created.isError).not.toBe(true);
  expect((await t.run((ctx) => ctx.db.query("events").collect())).map((row) => row.name)).toEqual(["Secret Team Rocket"]);
  expect((await call(t, bearer, "get_event", { organizationId: "org_two", slug: "rocket-night" })).isError).toBe(true);
  expect((await call(t, bearer, "create_event", { organizationId: "org_one", name: "Secret Team Rocket", slug: "Not A Slug", eventType: "demo", context: "   " })).isError).toBe(true);
  const missing = await call(t, bearer, "hide_submission", { organizationId: "org_one", slug: "rocket-night", submissionId: "missing-submission" });
  expect(JSON.parse(missing.content[0]?.text ?? "")).toEqual({ error: "invalid_operation", message: "Submission not found" });

  const events = await sent(t);
  expect(events.map((row) => [row.event, row.properties.$mcp_tool_name])).toEqual([
    ["$mcp_tool_call", "create_event"], ["$mcp_tool_call", "get_event"], ["$mcp_tool_call", "create_event"], ["$mcp_tool_call", "hide_submission"],
  ]);
  for (const row of events) {
    expect(row.distinct_id).toBe("user_operator");
    expect(row.properties).toMatchObject({ $mcp_source: "posthog_mcp_analytics", $mcp_server_name: "demo-queue", organization_id: "org_one", surface: "mcp", $mcp_duration_ms: expect.any(Number) });
    expect(row.properties).not.toHaveProperty("$mcp_parameters");
    expect(row.properties).not.toHaveProperty("$mcp_response");
    expect(row.properties).not.toHaveProperty("$session_id");
  }
  const [success, foreign, invalid, notFound] = events.map((row) => row.properties);
  expect(success).toMatchObject({ $mcp_is_error: false, $mcp_intent_source: "context_parameter" });
  expect(success?.$mcp_intent).toBe("Setting up the night for [redacted], who asked on [redacted]");
  expect(success).not.toHaveProperty("$mcp_error_type");
  expect(foreign).toMatchObject({ $mcp_is_error: true, $mcp_error_type: "unauthorized" });
  expect(foreign).not.toHaveProperty("$mcp_intent");
  expect(foreign).not.toHaveProperty("$mcp_error_message");
  expect(invalid).toMatchObject({ $mcp_is_error: true, $mcp_error_type: "validation" });
  expect(invalid).not.toHaveProperty("$mcp_intent");
  expect(notFound).toMatchObject({ $mcp_is_error: true, $mcp_error_type: "not_found", $mcp_error_message: "Submission not found" });
  expectPrivate(events, "Secret Team Rocket", "rocket-night", "missing-submission", "Not A Slug");
});

test("the SDK server reads the client's name and version from a 2026-07-28 request", async () => {
  const t = sdkServer();
  const bearer = await sdkToken();
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "2.1.0" } };
  const response = await t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "list_styles" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_styles", arguments: { organizationId: "org_one" }, _meta: meta } }) });
  expect(response.status).toBe(200);
  expect((await sent(t)).map((row) => row.properties)).toEqual([expect.objectContaining({ $mcp_tool_name: "list_styles", $mcp_is_error: false, $mcp_client_name: "test-client", $mcp_client_version: "2.1.0" })]);
});

test("nothing is sent without a PostHog token", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "");
  const t = sdkServer();
  const bearer = await sdkToken();
  expect((await call(t, bearer, "list_styles", { organizationId: "org_one", context })).isError).not.toBe(true);
  expect((await call(t, bearer, "get_event", { organizationId: "org_two", slug: "night" })).isError).toBe(true);
  expect(await sent(t)).toEqual([]);
});

function componentServer() {
  vi.stubEnv("CONVEX_SITE_URL", site);
  vi.stubEnv("WORKOS_MCP_RESOURCE", `${site}/mcp`);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  const t = convexTest(schema, modules);
  component.register(t);
  rateLimiterTest.register(t);
  return t;
}
async function componentKey(t: Test) {
  const identity = { subject: "user_alice", issuer: "https://api.workos.com/user_management/client_test", org_id: "org_one" };
  return (await t.withIdentity(identity).action(api.mcpConsent.createApiKey, { name: "Test key", organizationIds: ["org_one"], access: "manage" })).apiKey;
}

test("the component server reports one $mcp_tool_call per call without arguments, with the context redacted and kept from the tool", async () => {
  const t = componentServer();
  const bearer = await componentKey(t);
  expectContextArgument(toolList.parse(await rpc(t, bearer, "tools/list", {})).result.tools);
  posted = [];
  expect((await call(t, bearer, "create_event", { organizationId: "org_one", name: "Secret Team Rocket", slug: "rocket-night", eventType: "demo", meetUrl: "https://meet.example.com/room", context })).isError).not.toBe(true);
  const added = await call(t, bearer, "add_submission", { organizationId: "org_one", slug: "rocket-night", name: "Sam Private", demoTitle: "Hidden demo", description: "Live", phone: "+447700900000", email: "private@example.com", queueOrder: 0, context: "Adding a late team for the organiser" });
  expect(added.isError).not.toBe(true);
  expect((await call(t, bearer, "list_organizations", {})).isError).not.toBe(true);
  expect((await call(t, bearer, "list_events", { organizationId: "org_two", context: "" })).isError).toBe(true);
  // The component refuses wrongly typed arguments before any handler runs; this call fails the tool's own schema.
  expect((await call(t, bearer, "get_event_admin", { organizationId: "not-an-org", slug: "rocket-night" })).isError).toBe(true);

  const events = await sent(t);
  expect(events.map((row) => row.properties.$mcp_tool_name)).toEqual(["create_event", "add_submission", "list_organizations", "list_events", "get_event_admin"]);
  for (const row of events) {
    expect(row.event).toBe("$mcp_tool_call");
    expect(row.distinct_id).toBe("user_alice");
    expect(row.properties).toMatchObject({ $mcp_source: "posthog_mcp_analytics", $mcp_server_name: "demo-queue", surface: "mcp" });
    expect(row.properties).not.toHaveProperty("$mcp_parameters");
    expect(row.properties).not.toHaveProperty("$mcp_response");
  }
  const [created, submission, organizations, foreign, invalid] = events.map((row) => row.properties);
  expect(created).toMatchObject({ $mcp_is_error: false, organization_id: "org_one", $mcp_intent: "Setting up the night for [redacted], who asked on [redacted]", $mcp_intent_source: "context_parameter" });
  expect(submission).toMatchObject({ $mcp_is_error: false, $mcp_intent: "Adding a late team for the organiser" });
  expect(organizations).toMatchObject({ $mcp_is_error: false });
  expect(organizations).not.toHaveProperty("organization_id");
  expect(foreign).toMatchObject({ $mcp_is_error: true, $mcp_error_type: "unauthorized", organization_id: "org_two" });
  expect(foreign).not.toHaveProperty("$mcp_intent");
  expect(invalid).toMatchObject({ $mcp_is_error: true, $mcp_error_type: "validation" });
  expect(invalid).not.toHaveProperty("organization_id");
  expectPrivate(events, "not-an-org", "Secret Team Rocket", "rocket-night", "Sam Private", "Hidden demo", "private@example.com", "447700900000");
});
