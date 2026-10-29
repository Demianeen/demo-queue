import { convexTest } from "convex-test";
import { componentsGeneric, queryGeneric, type FunctionReference, type FunctionReturnType } from "convex/server";
import component from "@convex-dev/mcp/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { ADMIN_TOOLS } from "./mcpTools";
import { DEFAULT_EVENT_THEME } from "../lib/event-theme";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./convex.config.ts"]);
type Test = ReturnType<typeof setup>;
const site = "https://precious-elk-564.convex.site";
const resource = `${site}/mcp`;
const redirectUri = "https://agent.example/callback";
const verifier = "v".repeat(64);
type Membership = { user_id: string; organization_id: string; organization_name: string; status: "active" | "inactive" | "pending" };
const memberships = new Map<string, Membership[]>();
let providerAvailable = true;
const identity = (subject = "user_alice", org = "org_one") => ({ subject, issuer: "https://api.workos.com/user_management/client_test", org_id: org });
const toolsSchema = z.object({ result: z.object({ tools: z.array(z.object({ name: z.string(), inputSchema: z.unknown(), annotations: z.object({ readOnlyHint: z.boolean().optional() }).passthrough().optional() }).passthrough()) }) });
const toolResult = z.object({ result: z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })), isError: z.boolean().optional() }) });
const tokensSchema = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number(), token_type: z.literal("Bearer") });

beforeEach(() => {
  vi.useFakeTimers();
  providerAvailable = true;
  memberships.set("user_alice", ["one", "two"].map((name) => ({ user_id: "user_alice", organization_id: `org_${name}`, organization_name: name, status: "active" })));
  memberships.set("user_bob", [{ user_id: "user_bob", organization_id: "org_bob", organization_name: "Bob", status: "active" }]);
  vi.stubEnv("CONVEX_SITE_URL", site);
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  vi.stubEnv("WORKOS_API_KEY", "private-provider-key");
  vi.stubEnv("WORKOS_MCP_ISSUER", "https://login.example.com");
  vi.stubEnv("WORKOS_MCP_RESOURCE", resource);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  vi.stubGlobal("fetch", vi.fn(async (input: URL | Request | string) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://api.workos.com") throw new Error("Unexpected external provider");
    if (!providerAvailable) throw new Error("private-provider-key private-contact@example.com");
    const rows = memberships.get(url.searchParams.get("user_id") ?? "") ?? [];
    const selected = url.searchParams.get("organization_id");
    return Response.json({ data: selected ? rows.filter((row) => row.organization_id === selected) : rows, list_metadata: { after: null } });
  }));
});
afterEach(() => { vi.clearAllTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function setup() {
  const t = convexTest(schema, modules);
  component.register(t);
  t.registerComponent("mcp", component.schema, { ...component.modules, "./component/testInspection.ts": async () => ({ dump: queryGeneric({ args: {}, handler: async (ctx) => JSON.stringify({ grants: await ctx.db.query("grants").collect(), tokens: await ctx.db.query("tokens").collect(), requests: await ctx.db.query("authRequests").collect() }) }) }) });
  return t;
}
async function form(t: Test, endpoint: string, values: Record<string, string>) {
  return t.fetch(`/mcp/oauth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() });
}
async function register(t: Test) {
  const response = await t.fetch("/mcp/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Test agent", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) });
  expect(response.status).toBe(201);
  return z.object({ client_id: z.string() }).parse(await response.json()).client_id;
}
async function start(t: Test, clientId?: string, scope = "events:read events:manage") {
  const id = clientId ?? await register(t);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const params = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", resource, state: "client-state", scope });
  const response = await t.fetch(`/mcp/oauth/authorize?${params}`);
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (!location) throw new Error("Consent redirect missing");
  const requestId = new URL(location).searchParams.get("request");
  if (!requestId) throw new Error("Consent request missing");
  return { clientId: id, requestId };
}
async function approve(t: Test, request: Awaited<ReturnType<typeof start>>, options: { subject?: string; organizationIds?: string[]; allOrganizations?: true; access?: "read" | "manage" } = {}) {
  const result = await t.withIdentity(identity(options.subject)).action(api.mcpConsent.authorize, { requestId: request.requestId, approve: true, organizationIds: options.organizationIds ?? (options.allOrganizations ? [] : ["org_one"]), allOrganizations: options.allOrganizations, access: options.access ?? "manage" });
  if (!result.redirectUrl) throw new Error("Authorization redirect missing");
  const location = new URL(result.redirectUrl);
  expect(location.origin + location.pathname).toBe(redirectUri);
  expect(location.searchParams.get("state")).toBe("client-state");
  const code = location.searchParams.get("code");
  if (!code) throw new Error("Authorization code missing");
  return { ...request, code };
}
async function exchange(t: Test, approval: Awaited<ReturnType<typeof approve>>, overrides: Record<string, string> = {}) {
  return form(t, "token", { grant_type: "authorization_code", client_id: approval.clientId, code: approval.code, code_verifier: verifier, redirect_uri: redirectUri, resource, ...overrides });
}
async function oauth(t: Test, options: Parameters<typeof approve>[2] = {}) {
  const approval = await approve(t, await start(t), options);
  const response = await exchange(t, approval);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { ...approval, ...tokensSchema.parse(await response.json()) };
}
async function key(t: Test, options: { subject?: string; organizationIds?: string[]; allOrganizations?: true; access?: "read" | "manage"; name?: string } = {}) {
  return t.withIdentity(identity(options.subject)).action(api.mcpConsent.createApiKey, { name: options.name ?? "Test key", organizationIds: options.organizationIds ?? (options.allOrganizations ? [] : ["org_one"]), allOrganizations: options.allOrganizations, access: options.access ?? "manage" });
}
async function rpc(t: Test, bearer: string, method: string, params: unknown = {}) {
  return t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function call(t: Test, bearer: string, name: string, args: Record<string, unknown>) {
  const response = await rpc(t, bearer, "tools/call", { name, arguments: args });
  expect(response.status, name).toBe(200);
  const result = toolResult.parse(await response.json()).result;
  const text = result.content[0]?.text;
  if (!text) throw new Error(`Missing result for ${name}`);
  let value: unknown;
  try { value = JSON.parse(text); } catch { value = text; }
  return { result, value };
}
async function success(t: Test, bearer: string, name: string, args: Record<string, unknown>) {
  const called = await call(t, bearer, name, args);
  expect(called.result.isError, `${name}: ${JSON.stringify(called.value)}`).not.toBe(true);
  return called.value;
}
async function listed(t: Test, bearer: string) {
  const response = await rpc(t, bearer, "tools/list");
  expect(response.status).toBe(200);
  return toolsSchema.parse(await response.json()).result.tools;
}
const eventInput = (organizationId: string, slug: string) => ({ organizationId, name: slug, slug, eventType: "demo", meetUrl: "https://meet.example.com/room" });
const createdEvent = z.object({ id: z.string(), slug: z.string() });
const createdSubmission = z.object({ submissionId: z.string() });

function example(value: unknown): unknown {
  const shape = z.object({ type: z.string().optional(), const: z.unknown().optional(), enum: z.array(z.unknown()).optional(), anyOf: z.array(z.unknown()).optional(), properties: z.record(z.string(), z.unknown()).optional(), required: z.array(z.string()).optional() }).passthrough().parse(value);
  if ("const" in shape) return shape.const;
  if (shape.enum) return shape.enum[0];
  if (shape.anyOf?.[0]) return example(shape.anyOf[0]);
  switch (shape.type) {
    case "object": return Object.fromEntries((shape.required ?? []).map((name) => [name, example(shape.properties?.[name])]));
    case "array": return [];
    case "boolean": return false;
    case "number": case "integer": return 1;
    case "null": return null;
    case "string": return "example";
    default: throw new Error("Unsupported tool schema fixture");
  }
}

test("component OAuth discovery, DCR, PKCE consent, initialize and discovery expose 60 tools without provider token signing", async () => {
  const t = setup();
  const metadata = await t.fetch("/.well-known/oauth-protected-resource/mcp");
  expect(await metadata.json()).toMatchObject({ resource, authorization_servers: [site], scopes_supported: ["events:read", "events:manage"] });
  const unauthorized = await t.fetch("/mcp", { method: "POST" });
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource/mcp");
  const connection = await oauth(t, { organizationIds: ["org_one", "org_two"] });
  const initialized = await rpc(t, connection.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "demo-queue" } } });
  expect(await success(t, connection.access_token, "list_organizations", {})).toEqual({ organizations: [{ id: "org_one", name: "one" }, { id: "org_two", name: "two" }], nextCursor: null, hasMore: false });
  const tools = await listed(t, connection.access_token);
  expect(tools.map((tool) => tool.name)).toEqual(["list_organizations", "list_events", "get_event", "create_event", "list_styles", "create_style", "set_default_style", ...ADMIN_TOOLS.map((tool) => tool.name)]);
  expect(tools).toHaveLength(60);
  expect(await success(t, connection.access_token, "list_events", { organizationId: "org_one" })).toEqual({ page: [], isDone: true, continueCursor: "_end_cursor" });
});

test("an approved multi-organization OAuth connection persists writes and hides contacts from general reads", async () => {
  const t = setup();
  const connection = await oauth(t, { organizationIds: ["org_one", "org_two"] });
  for (const org of ["org_one", "org_two"]) {
    const event = createdEvent.parse(await success(t, connection.access_token, "create_event", eventInput(org, `${org.replace("_", "-")}-event`)));
    const submission = createdSubmission.parse(await success(t, connection.access_token, "add_submission", { organizationId: org, slug: event.slug, name: "Sam", demoTitle: "A working demo", description: "Live workflow", phone: "+447700900000", email: "private@example.com", queueOrder: 0 }));
    await success(t, connection.access_token, "publish_queue", { organizationId: org, slug: event.slug });
    const admin = await success(t, connection.access_token, "get_event_admin", { organizationId: org, slug: event.slug });
    expect(admin).toMatchObject({ event: { queuePublished: true }, lineup: [{ id: submission.submissionId, demoTitle: "A working demo" }] });
    expect(JSON.stringify(admin)).not.toContain("private@example.com");
    expect(JSON.stringify(admin)).not.toContain("participantToken");
    expect(await success(t, connection.access_token, "get_submission_contacts", { organizationId: org, slug: event.slug, submissionId: submission.submissionId })).toMatchObject({ email: "private@example.com" });
  }
  const events = await t.run((ctx) => ctx.db.query("events").collect());
  expect(events.map((event) => event.workosOrganizationId).sort()).toEqual(["org_one", "org_two"]);
  expect((await t.run((ctx) => ctx.db.query("auditLog").collect())).every((row) => row.actor.includes("user_alice"))).toBe(true);
});

test("read-only OAuth consent narrows broad requested scopes and blocks every direct write", async () => {
  const t = setup();
  const full = await key(t);
  await success(t, full.apiKey, "create_event", eventInput("org_one", "read-only-event"));
  const read = await oauth(t, { access: "read" });
  const fullTools = await listed(t, full.apiKey);
  const readTools = await listed(t, read.access_token);
  expect(readTools.map((tool) => tool.name).sort()).toEqual(fullTools.filter((tool) => tool.annotations?.readOnlyHint && !["get_submission_contacts", "list_judge_links"].includes(tool.name)).map((tool) => tool.name).sort());
  expect(await success(t, read.access_token, "get_event", { organizationId: "org_one", slug: "read-only-event" })).toMatchObject({ slug: "read-only-event" });
  for (const tool of fullTools.filter((tool) => !readTools.some((readTool) => readTool.name === tool.name))) {
    const args = z.record(z.string(), z.unknown()).parse(example(tool.inputSchema));
    const response = await rpc(t, read.access_token, "tools/call", { name: tool.name, arguments: { ...args, organizationId: "org_one" } });
    expect(response.status, tool.name).toBe(403);
    expect(await response.json(), tool.name).toEqual({ error: "insufficient_scope" });
  }
  expect((await t.run((ctx) => ctx.db.query("events").collect())).map((event) => event.slug)).toEqual(["read-only-event"]);
});

test("manage-only OAuth requests include reads and respect read-only consent", async () => {
  const t = setup();
  const managed = await approve(t, await start(t, undefined, "events:manage"));
  const managedResponse = await exchange(t, managed);
  expect(managedResponse.status).toBe(200);
  const managedToken = tokensSchema.extend({ scope: z.string() }).parse(await managedResponse.json());
  expect(managedToken.scope).toBe("events:manage");
  await success(t, managedToken.access_token, "create_event", eventInput("org_one", "manage-implies-read"));
  expect(await success(t, managedToken.access_token, "list_events", { organizationId: "org_one" })).toMatchObject({ page: [{ slug: "manage-implies-read" }] });
  expect((await listed(t, managedToken.access_token))).toHaveLength(60);

  const read = await approve(t, await start(t, undefined, "events:manage"), { access: "read" });
  const readResponse = await exchange(t, read);
  expect(readResponse.status).toBe(200);
  const readToken = tokensSchema.parse(await readResponse.json());
  expect(await success(t, readToken.access_token, "list_events", { organizationId: "org_one" })).toMatchObject({ page: [{ slug: "manage-implies-read" }] });
  const denied = await rpc(t, readToken.access_token, "tools/call", { name: "create_event", arguments: eventInput("org_one", "read-must-not-write") });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ error: "insufficient_scope" });
  expect((await t.run((ctx) => ctx.db.query("events").collect())).map((event) => event.slug)).toEqual(["manage-implies-read"]);
});

test("settings report effective permissions when a client requests only reads", async () => {
  const t = setup();
  const approval = await approve(t, await start(t, undefined, "events:read"), { access: "manage" });
  expect((await exchange(t, approval)).status).toBe(200);
  const connections = (await t.withIdentity(identity()).query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 100, cursor: null } })).page;
  expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({ access: "read", organizationIds: ["org_one"] });
});

test("selected organizations stay fixed as memberships change and live revocation fails closed", async () => {
  const t = setup();
  const selected = await key(t, { organizationIds: ["org_one"] });
  const allCurrent = await key(t, { organizationIds: ["org_one", "org_two"] });
  expect(await success(t, allCurrent.apiKey, "create_event", eventInput("org_two", "second-organization"))).toMatchObject({ slug: "second-organization" });
  expect((await call(t, selected.apiKey, "list_events", { organizationId: "org_two" })).value).toEqual({ error: "access_denied" });
  memberships.get("user_alice")?.push({ user_id: "user_alice", organization_id: "org_three", organization_name: "Three", status: "active" });
  expect((await call(t, allCurrent.apiKey, "list_events", { organizationId: "org_three" })).value).toEqual({ error: "access_denied" });
  memberships.set("user_alice", memberships.get("user_alice")?.filter((row) => row.organization_id !== "org_two") ?? []);
  expect((await call(t, allCurrent.apiKey, "list_events", { organizationId: "org_two" })).value).toEqual({ error: "access_denied" });
  expect(await success(t, allCurrent.apiKey, "list_events", { organizationId: "org_one" })).toEqual({ page: [], isDone: true, continueCursor: "_end_cursor" });
  providerAvailable = false;
  const failed = await call(t, allCurrent.apiKey, "create_event", eventInput("org_one", "must-not-exist"));
  expect(failed.value).toEqual({ error: "provider_unavailable" });
  expect(JSON.stringify(failed)).not.toContain("private-provider-key");
  expect(JSON.stringify(failed)).not.toContain("private-contact@example.com");
  expect((await t.run((ctx) => ctx.db.query("events").collect())).map((event) => event.slug)).toEqual(["second-organization"]);
});

test("API keys are disclosed once, store no plaintext, stay owner scoped and stop immediately on revoke", async () => {
  const t = setup();
  const alice = t.withIdentity(identity());
  const bob = t.withIdentity(identity("user_bob", "org_bob"));
  const issued = await key(t, { name: "Alice laptop" });
  const bobFull = await key(t, { subject: "user_bob", organizationIds: ["org_bob"] });
  const bobRead = await key(t, { subject: "user_bob", organizationIds: ["org_bob"], access: "read" });
  expect(issued.apiKey).toMatch(/^mcp_/);
  expect(issued.url).toBe(resource);
  const connections = (await alice.query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 100, cursor: null } })).page;
  expect(connections).toMatchObject([{ id: issued.id, name: "Alice laptop", organizationIds: ["org_one"], access: "manage" }]);
  expect(JSON.stringify(connections)).not.toContain(issued.apiKey);
  const appRows = await t.run(async (ctx) => ({ approvals: await ctx.db.query("mcpApprovals").collect(), organizations: await ctx.db.query("mcpApprovalOrganizations").collect() }));
  expect(JSON.stringify(appRows)).not.toContain(issued.apiKey);
  const inspect: FunctionReference<"query", "internal", Record<string, never>, string> = componentsGeneric().mcp.testInspection.dump;
  const storedCredentials = await t.query(inspect, {});
  expect(JSON.stringify(storedCredentials)).not.toContain(issued.apiKey);
  expect(JSON.stringify(storedCredentials)).toContain("hash");
  expect((await bob.query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 100, cursor: null } })).page.map((connection) => connection.id).sort()).toEqual([bobFull.id, bobRead.id].sort());
  await expect(bob.mutation(api.mcpConsent.revokeConnection, { id: issued.id })).rejects.toThrow();
  expect((await listed(t, issued.apiKey))).toHaveLength(60);
  await alice.mutation(api.mcpConsent.revokeConnection, { id: issued.id });
  expect((await rpc(t, issued.apiKey, "tools/list")).status).toBe(401);
  expect((await listed(t, bobFull.apiKey))).toHaveLength(60);
  expect((await listed(t, bobRead.apiKey)).some((tool) => tool.name === "create_event")).toBe(false);
});

test("anonymous, foreign-issuer and foreign-organization requests cannot create credentials or approve grants", async () => {
  const t = setup();
  const request = await start(t);
  const args = { requestId: request.requestId, approve: true, organizationIds: ["org_one"], access: "manage" as const };
  await expect(t.action(api.mcpConsent.authorize, args)).rejects.toThrow();
  await expect(t.action(api.mcpConsent.createApiKey, { name: "Anonymous", organizationIds: ["org_one"], access: "manage" })).rejects.toThrow();
  await expect(t.withIdentity({ ...identity(), issuer: "https://evil.example" }).action(api.mcpConsent.authorize, args)).rejects.toThrow();
  await expect(t.withIdentity(identity("user_bob", "org_bob")).action(api.mcpConsent.authorize, args)).rejects.toThrow();
  await expect(key(t, { organizationIds: ["org_bob"] })).rejects.toThrow();
  await expect(key(t, { organizationIds: [] })).rejects.toThrow();
  const approved = await approve(t, request);
  await expect(t.withIdentity(identity("user_bob", "org_bob")).action(api.mcpConsent.authorize, { ...args, organizationIds: ["org_bob"] })).rejects.toThrow();
  expect((await exchange(t, approved)).status).toBe(200);
});

test("PKCE mismatch, code replay, wrong client, redirect and resource never issue an unintended token", async () => {
  const t = setup();
  const wrongVerifier = await approve(t, await start(t));
  expect(await (await exchange(t, wrongVerifier, { code_verifier: "x".repeat(64) })).json()).toMatchObject({ error: "invalid_grant" });
  expect(await (await exchange(t, wrongVerifier)).json()).toMatchObject({ error: "invalid_grant" });
  const invalidBindings: Record<string, string>[] = [{ client_id: "another-client" }, { redirect_uri: "https://evil.example/callback" }];
  for (const override of invalidBindings) {
    const approved = await approve(t, await start(t));
    expect(await (await exchange(t, approved, override)).json()).toMatchObject({ error: "invalid_grant" });
  }
  const correct = await approve(t, await start(t));
  expect(await (await exchange(t, correct, { resource: "https://evil.example/mcp" })).json()).toMatchObject({ error: "invalid_target" });
  const exchanged = tokensSchema.parse(await (await exchange(t, correct)).json());
  expect((await listed(t, exchanged.access_token))).toHaveLength(60);
  expect(await (await exchange(t, correct)).json()).toMatchObject({ error: "invalid_grant" });
});

test("expired authorization requests, codes and access tokens are rejected and refresh tokens cannot act as bearer credentials", async () => {
  const t = setup();
  const request = await start(t);
  vi.advanceTimersByTime(10 * 60_000 + 1);
  await expect(approve(t, request)).rejects.toThrow();
  const code = await approve(t, await start(t));
  vi.advanceTimersByTime(60_001);
  expect(await (await exchange(t, code)).json()).toMatchObject({ error: "invalid_grant" });
  const connection = await oauth(t);
  expect((await rpc(t, connection.refresh_token, "tools/list")).status).toBe(401);
  vi.advanceTimersByTime(connection.expires_in * 1000 + 1);
  expect((await rpc(t, connection.access_token, "tools/list")).status).toBe(401);
  const refreshed = await form(t, "token", { grant_type: "refresh_token", client_id: connection.clientId, refresh_token: connection.refresh_token });
  expect(refreshed.status).toBe(200);
  expect((await listed(t, tokensSchema.parse(await refreshed.json()).access_token))).toHaveLength(60);
});

test("refresh tokens rotate, reject wrong clients and revoke their connection on old-generation reuse", async () => {
  const t = setup();
  const connection = await oauth(t);
  const other = await register(t);
  const wrong = await form(t, "token", { grant_type: "refresh_token", client_id: other, refresh_token: connection.refresh_token });
  expect(await wrong.json()).toMatchObject({ error: "invalid_grant" });
  let current = connection.refresh_token;
  let latest = connection.access_token;
  for (let generation = 0; generation < 3; generation++) {
    const response = await form(t, "token", { grant_type: "refresh_token", client_id: connection.clientId, refresh_token: current });
    expect(response.status).toBe(200);
    const next = tokensSchema.parse(await response.json());
    expect(next.refresh_token).not.toBe(current);
    current = next.refresh_token;
    latest = next.access_token;
  }
  expect((await listed(t, latest))).toHaveLength(60);
  const replay = await form(t, "token", { grant_type: "refresh_token", client_id: connection.clientId, refresh_token: connection.refresh_token });
  expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  expect((await rpc(t, latest, "tools/list")).status).toBe(401);
  expect(await (await form(t, "token", { grant_type: "refresh_token", client_id: connection.clientId, refresh_token: current })).json()).toMatchObject({ error: "invalid_grant" });
});

test("two approvals for one OAuth client exchange in reverse order with independent organizations and revocation", async () => {
  const t = setup();
  const clientId = await register(t);
  const first = await approve(t, await start(t, clientId), { organizationIds: ["org_one"] });
  const second = await approve(t, await start(t, clientId), { organizationIds: ["org_two"], access: "read" });
  const secondToken = tokensSchema.parse(await (await exchange(t, second)).json());
  const firstToken = tokensSchema.parse(await (await exchange(t, first)).json());
  expect((await listed(t, firstToken.access_token))).toHaveLength(60);
  expect((await listed(t, secondToken.access_token)).some((tool) => tool.name === "create_event")).toBe(false);
  expect((await call(t, firstToken.access_token, "list_events", { organizationId: "org_two" })).value).toEqual({ error: "access_denied" });
  expect((await call(t, secondToken.access_token, "list_events", { organizationId: "org_one" })).value).toEqual({ error: "access_denied" });
  expect(await success(t, secondToken.access_token, "list_events", { organizationId: "org_two" })).toEqual({ page: [], isDone: true, continueCursor: "_end_cursor" });
  const alice = t.withIdentity(identity());
  const connections = (await alice.query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 100, cursor: null } })).page;
  expect(connections).toHaveLength(2);
  const firstConnection = connections.find((connection) => connection.organizationIds.includes("org_one"));
  if (!firstConnection) throw new Error("First connection missing");
  await alice.mutation(api.mcpConsent.revokeConnection, { id: firstConnection.id });
  expect((await rpc(t, firstToken.access_token, "tools/list")).status).toBe(401);
  expect((await listed(t, secondToken.access_token)).some((tool) => tool.name === "list_events")).toBe(true);
  expect(await (await form(t, "token", { grant_type: "refresh_token", client_id: clientId, refresh_token: firstToken.refresh_token })).json()).toMatchObject({ error: "invalid_grant" });
});

test("denying OAuth consent redirects safely and never creates a usable connection", async () => {
  const t = setup();
  const request = await start(t);
  const denied = await t.withIdentity(identity()).action(api.mcpConsent.authorize, { requestId: request.requestId, approve: false, organizationIds: [], access: "read" });
  if (!denied.redirectUrl) throw new Error("Denied redirect missing");
  const url = new URL(denied.redirectUrl);
  expect(url.origin + url.pathname).toBe(redirectUri);
  expect(url.searchParams.get("error")).toBe("access_denied");
  expect(url.searchParams.get("state")).toBe("client-state");
  expect((await t.withIdentity(identity()).query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 100, cursor: null } })).page).toEqual([]);
  await expect(approve(t, request)).rejects.toThrow();
});

test("device consent requires the displayed code and yields a short-lived read-only token without refresh", async () => {
  const t = setup();
  const started = await form(t, "device", { client_id: "mcp-agent", client_name: "Device test", resource, scope: "events:read events:manage" });
  expect(started.status).toBe(200);
  const device = z.object({ device_code: z.string(), user_code: z.string(), verification_uri_complete: z.string(), interval: z.number() }).parse(await started.json());
  const requestId = new URL(device.verification_uri_complete).searchParams.get("request");
  if (!requestId) throw new Error("Device request missing");
  const args = { requestId, approve: true, organizationIds: ["org_one"], access: "read" as const };
  const owner = t.withIdentity(identity());
  const request = await owner.query(api.mcpConsent.getRequest, { requestId });
  expect(request).toMatchObject({ kind: "device", status: "pending", clientName: "Device test" });
  expect(request).not.toHaveProperty("userCode");
  expect(JSON.stringify(request)).not.toContain(device.user_code);
  await expect(owner.action(api.mcpConsent.authorize, args)).rejects.toThrow();
  await expect(owner.action(api.mcpConsent.authorize, { ...args, userCode: "WRONG-CODE" })).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query("mcpApprovals").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("mcpApprovalOrganizations").collect())).toEqual([]);
  expect(await owner.query(api.mcpConsent.getRequest, { requestId })).toMatchObject({ status: "pending" });
  expect(await owner.action(api.mcpConsent.authorize, { ...args, userCode: device.user_code })).toEqual({ redirectUrl: null });
  const response = await form(t, "token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: "mcp-agent", device_code: device.device_code });
  expect(response.status).toBe(200);
  const credentials = z.object({ access_token: z.string(), expires_in: z.number() }).passthrough().parse(await response.json());
  expect(credentials).not.toHaveProperty("refresh_token");
  expect(await (await form(t, "token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: "mcp-agent", device_code: device.device_code })).json()).toEqual({ error: "invalid_grant" });
  expect((await listed(t, credentials.access_token)).some((tool) => tool.name === "create_event")).toBe(false);
  expect(await success(t, credentials.access_token, "list_events", { organizationId: "org_one" })).toEqual({ page: [], isDone: true, continueCursor: "_end_cursor" });
  vi.advanceTimersByTime(credentials.expires_in * 1000 + 1);
  expect((await rpc(t, credentials.access_token, "tools/list")).status).toBe(401);
});

test("valid foreign submission and saved-style IDs cannot read or modify another owner's data", async () => {
  const t = setup();
  const alice = await key(t);
  const bob = await key(t, { subject: "user_bob", organizationIds: ["org_bob"] });
  const aliceEvent = createdEvent.parse(await success(t, alice.apiKey, "create_event", eventInput("org_one", "alice-event")));
  const bobEvent = createdEvent.parse(await success(t, bob.apiKey, "create_event", eventInput("org_bob", "bob-event")));
  const aliceSubmission = createdSubmission.parse(await success(t, alice.apiKey, "add_submission", { organizationId: "org_one", slug: aliceEvent.slug, name: "Alice", demoTitle: "Alice private demo", description: "Private", phone: "+447700900001", queueOrder: 0, list: "pool" }));
  const style = z.object({ id: z.string() }).parse(await success(t, alice.apiKey, "create_style", { organizationId: "org_one", name: "Private style", theme: DEFAULT_EVENT_THEME }));
  for (const [name, args] of [
    ["get_submission_contacts", { slug: bobEvent.slug, submissionId: aliceSubmission.submissionId }],
    ["update_submission", { slug: bobEvent.slug, submissionId: aliceSubmission.submissionId, name: "Stolen", demoTitle: "Stolen", description: "Stolen", phone: "+447700900001" }],
    ["hide_submission", { slug: bobEvent.slug, submissionId: aliceSubmission.submissionId }],
    ["set_default_style", { selection: { kind: "saved", id: style.id } }],
    ["get_event_admin", { slug: aliceEvent.slug }],
  ] as const) {
    const denied = await call(t, bob.apiKey, name, { organizationId: "org_bob", ...args });
    expect(denied.result.isError, name).toBe(true);
    expect(JSON.stringify(denied.value), name).not.toContain("Alice private demo");
  }
  expect(await success(t, alice.apiKey, "get_event_admin", { organizationId: "org_one", slug: aliceEvent.slug })).toMatchObject({ pool: [{ id: aliceSubmission.submissionId, name: "Alice", demoTitle: "Alice private demo" }] });
  expect((await t.run((ctx) => ctx.db.query("organizationStyles").collect())).map((row) => ({ name: row.name, organizationId: row.organizationId }))).toEqual([{ name: "Private style", organizationId: "org_one" }]);
});

test("failed domain validation rolls back mutations and audit records through the component transport", async () => {
  const t = setup();
  const full = await key(t);
  const input = eventInput("org_one", "unique-event");
  await success(t, full.apiKey, "create_event", input);
  const before = await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), audit: await ctx.db.query("auditLog").collect() }));
  expect((await call(t, full.apiKey, "create_event", { ...input, name: "Cannot replace existing event" })).result.isError).toBe(true);
  expect(await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), audit: await ctx.db.query("auditLog").collect() }))).toEqual(before);
});

test("malformed admin arguments return structured safe errors through component HTTP", async () => {
  const t = setup();
  const connection = await key(t);
  await success(t, connection.apiKey, "create_event", eventInput("org_one", "safe-validation"));
  const before = await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), audit: await ctx.db.query("auditLog").collect() }));
  const invalid = await call(t, connection.apiKey, "get_event_admin", { organizationId: "org_private-provider-key", slug: "safe-validation" });
  expect(invalid.result.isError).toBe(true);
  expect(invalid.value).toEqual({ error: "operation_failed" });
  expect(JSON.stringify(invalid)).not.toContain("private-provider-key");
  expect(JSON.stringify(invalid)).not.toContain("Invalid tool arguments");
  expect(await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), audit: await ctx.db.query("auditLog").collect() }))).toEqual(before);
  expect(await success(t, connection.apiKey, "get_event_admin", { organizationId: "org_one", slug: "safe-validation" })).toMatchObject({ event: { slug: "safe-validation" } });
});

test("all 60 component tools preserve the existing flat argument names and required fields", async () => {
  const t = setup();
  const { createToolServer, serveMcp } = await import("./mcpWorkos");
  const legacy = toolsSchema.parse(JSON.parse(await t.run(async (ctx) => {
    const response = await serveMcp(new Request(`${site}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) }), () => createToolServer(ctx, { userId: "user_alice", organizationId: "org_one", actor: "alice" }, { issuer: "https://login.example.com", resource, requestOrigin: site, apiKey: "private-provider-key" }));
    return response.text();
  })));
  const connection = await key(t);
  const componentTools = await listed(t, connection.apiKey);
  const argumentShape = (value: unknown) => {
    const parsed = z.object({ properties: z.record(z.string(), z.unknown()), required: z.array(z.string()).optional(), additionalProperties: z.boolean().optional() }).parse(value);
    return { fields: Object.keys(parsed.properties).sort(), required: (parsed.required ?? []).sort(), additionalProperties: parsed.additionalProperties };
  };
  expect(componentTools.map((tool) => tool.name)).toEqual(legacy.result.tools.map((tool) => tool.name));
  for (const tool of componentTools) {
    const previous = legacy.result.tools.find((item) => item.name === tool.name);
    if (!previous) throw new Error(`Missing legacy tool ${tool.name}`);
    expect(argumentShape(tool.inputSchema), tool.name).toEqual(argumentShape(previous.inputSchema));
  }
});

test.each(["selected", "all"])("every organization-bound tool with %s approval denies foreign and removed organizations before domain effects", async (policy) => {
  const t = setup();
  const selected = await key(t, policy === "all" ? { allOrganizations: true } : {});
  await success(t, selected.apiKey, "create_event", eventInput("org_one", "preserved-event"));
  const tools = await listed(t, selected.apiKey);
  const before = await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), submissions: await ctx.db.query("submissions").collect(), styles: await ctx.db.query("organizationStyles").collect(), audit: await ctx.db.query("auditLog").collect() }));
  for (const tool of tools.filter((tool) => tool.name !== "list_organizations")) {
    const args = z.record(z.string(), z.unknown()).parse(example(tool.inputSchema));
    const foreign = await call(t, selected.apiKey, tool.name, { ...args, organizationId: "org_bob" });
    expect(foreign.result.isError, `${tool.name} foreign`).toBe(true);
    expect(foreign.value, `${tool.name} foreign`).toEqual({ error: "access_denied" });
    memberships.set("user_alice", []);
    const removed = await call(t, selected.apiKey, tool.name, { ...args, organizationId: "org_one" });
    expect(removed.result.isError, `${tool.name} removed`).toBe(true);
    expect(removed.value, `${tool.name} removed`).toEqual({ error: "access_denied" });
    memberships.set("user_alice", [{ user_id: "user_alice", organization_id: "org_one", organization_name: "One", status: "active" }]);
  }
  expect(await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), submissions: await ctx.db.query("submissions").collect(), styles: await ctx.db.query("organizationStyles").collect(), audit: await ctx.db.query("auditLog").collect() }))).toEqual(before);
});

test("component HTTP queue controls persist timer, lineup, submission, style and destructive-confirmation workflows", async () => {
  const t = setup();
  const { apiKey } = await key(t);
  const org = "org_one";
  const slug = "complete-queue";
  const run = (name: string, args: Record<string, unknown> = {}) => success(t, apiKey, name, { organizationId: org, slug, ...args });
  const style = z.object({ id: z.string() }).parse(await success(t, apiKey, "create_style", { organizationId: org, name: "Queue style", theme: DEFAULT_EVENT_THEME }));
  expect(await success(t, apiKey, "set_default_style", { organizationId: org, selection: { kind: "saved", id: style.id } })).toMatchObject({ styleId: style.id });
  expect(await success(t, apiKey, "list_styles", { organizationId: org })).toMatchObject({ styles: [{ id: style.id, isDefault: true }] });
  await success(t, apiKey, "create_event", eventInput(org, slug));
  expect(await run("get_event_overview")).toMatchObject({ name: slug, submissionCount: 0 });
  expect(await run("ai_shuffle", { prompt: "Choose good demos" })).toEqual({ count: 0 });
  const fields = { name: "Presenter", demoTitle: "A complete demo", description: "Live controls", phone: "+447700900001" };
  const first = createdSubmission.parse(await run("add_submission", { ...fields, queueOrder: 1 }));
  const second = createdSubmission.parse(await run("add_submission", { ...fields, demoTitle: "Second demo", queueOrder: 2 }));
  const third = createdSubmission.parse(await run("add_submission", { ...fields, demoTitle: "Pool demo", queueOrder: 3, list: "pool" }));
  await run("update_submission", { ...fields, submissionId: first.submissionId, demoTitle: "Updated demo" });
  await run("hide_submission", { submissionId: third.submissionId });
  await run("restore_submission", { submissionId: third.submissionId });
  await run("move_to_pool", { submissionId: second.submissionId });
  await run("reorder_lineup", { orderedIds: [third.submissionId, first.submissionId] });
  await run("set_lineup_target", { target: 2 });
  await run("shuffle_lineup");
  await run("publish_queue");
  await run("set_stage_screen_mode", { mode: "demo" });
  for (const name of ["set_submission_count_visible", "set_stage_meet_link_visible", "set_stage_timer_visible", "set_demo_timer_visible"]) await run(name, { visible: true });
  await run("set_stage_timer_duration", { durationMs: 60000 });
  await run("start_stage_timer");
  await run("adjust_stage_timer", { deltaMs: 10000 });
  await run("pause_stage_timer");
  await run("reset_stage_timer");
  await run("set_demo_timer_duration", { durationMs: 90000 });
  await run("start_demo_timer");
  await run("adjust_demo_timer", { deltaMs: 5000 });
  await run("pause_demo_timer");
  expect(await run("get_event_admin")).toMatchObject({ event: { queuePublished: true, demoTimer: { status: "paused", durationMs: 90000, remainingMs: 95000 } } });
  await run("advance_presenter");
  await run("restore_previous_presenter");
  await run("skip_current_presenter");
  await run("mark_no_show");
  const before = await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), submissions: await ctx.db.query("submissions").collect(), audit: await ctx.db.query("auditLog").collect() }));
  expect((await call(t, apiKey, "clear_queue", { organizationId: org, slug, confirmation: { action: "clear_queue", slug: "wrong-event" } })).value).toEqual({ error: "invalid_operation", message: "Confirmation must match the event." });
  expect(await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), submissions: await ctx.db.query("submissions").collect(), audit: await ctx.db.query("auditLog").collect() }))).toEqual(before);
  await run("clear_queue", { confirmation: { action: "clear_queue", slug } });
  expect(await run("get_event_admin")).toMatchObject({ lineup: [], pool: [], noShows: [], completed: [] });
  await run("change_event_type", { eventType: "hackathon", confirmReset: false, confirmation: { action: "change_event_type", slug, eventType: "hackathon" } });
  expect(await run("get_event")).toMatchObject({ eventType: "hackathon" });
});

test("component HTTP judging tools prepare, redistribute, time and close a real round", async () => {
  const t = setup();
  const { apiKey } = await key(t);
  const slug = "http-judging";
  const org = "org_one";
  const run = (name: string, args: Record<string, unknown> = {}) => success(t, apiKey, name, { organizationId: org, slug, ...args });
  await success(t, apiKey, "create_event", { ...eventInput(org, slug), eventType: "hackathon" });
  expect(await run("save_judges", { judges: ["Alex", "Sam", "Taylor", "Jo"] })).toMatchObject({ judgeCount: 4 });
  const added = z.object({ submissionIds: z.array(z.string()) }).parse(await run("add_test_submissions", { submissions: [1, 2].map((index) => ({ name: `Team ${index}`, teamName: `Team ${index}`, demoTitle: `Project ${index}`, description: "Working prototype", phone: "+447700900001", teamMembers: ["One", "Two"] })) }));
  const link = z.object({ path: z.string() }).parse(await run("create_judge_link", { judgeName: "Alex" }));
  expect(await run("list_judge_links")).toMatchObject([{ judgeKey: "alex", active: true, path: link.path }]);
  await run("close_submissions");
  await run("start_assignment_preparation");
  expect(await run("prepare_assignment_batch")).toEqual({ processed: 2, done: true });
  const progress = z.object({ scoring: z.array(z.object({ submissionId: z.string(), assignedJudges: z.array(z.string()) })) }).parse(await run("get_judging_progress"));
  expect(progress.scoring.map((row) => row.submissionId).sort()).toEqual([...added.submissionIds].sort());
  const unavailable = progress.scoring[0]?.assignedJudges[0];
  if (!unavailable) throw new Error("No judge assigned");
  const preview = z.array(z.object({ submissionId: z.string(), judges: z.array(z.string()) })).parse(await run("preview_redistribution", { unavailableJudgeKey: unavailable.toLowerCase() }));
  expect(preview.length).toBeGreaterThan(0);
  await run("apply_redistribution", { unavailableJudgeKey: unavailable.toLowerCase(), assignments: preview.map(({ submissionId, judges }) => ({ submissionId, judges })) });
  await run("set_judging_timer", { durationMs: 60000 });
  await run("start_judging");
  await run("add_judging_time", { deltaMs: 10000 });
  expect(await run("get_judging_timer")).toMatchObject({ status: "open", timerStatus: "running", remainingMs: 70000 });
  const redistributed = z.object({ scoring: z.array(z.object({ assignedJudges: z.array(z.string()) })) }).parse(await run("get_judging_progress"));
  const judges = [...new Set(redistributed.scoring.flatMap((row) => row.assignedJudges))];
  for (const judgeName of judges) {
    const activeLink = z.object({ path: z.string() }).parse(await run("create_judge_link", { judgeName }));
    const capabilityToken = activeLink.path.split("/").at(-1);
    if (!capabilityToken) throw new Error("Judge token missing");
    const assignments = await t.query(api.judging.getMyAssignments, { slug, capabilityToken });
    for (const assignment of assignments.assignments) {
      expect(await t.mutation(api.judging.saveReview, { slug, capabilityToken, submissionId: assignment.id, innovation: 7, execution: 8, demoClarity: 9 })).toEqual({ completed: true });
    }
  }
  await run("close_judging");
  const reviewedJudge = judges[0];
  if (!reviewedJudge) throw new Error("Reviewed judge missing");
  expect(await run("save_normalization_decision", { judgeKey: reviewedJudge.toLowerCase(), decision: "raw" })).toEqual({ scoreBasisReady: true });
  expect(await run("get_normalization_overview")).toMatchObject({ judgingStatus: "closed" });
  await run("reopen_judging");
  expect(await run("get_judging_timer")).toMatchObject({ status: "open" });
  await t.run(async (ctx) => {
    const event = await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!event) throw new Error("Judging event missing");
    await ctx.db.patch(event._id, { judgingSheetId: "synthetic-sheet", judgingSheetUrl: "https://docs.google.com/spreadsheets/d/synthetic-sheet", judgingSheetSyncRevision: 0 });
  });
  await run("request_judging_sheet_sync");
  expect(await run("get_event_admin")).toMatchObject({ event: { judgingSheetSyncRevision: 1 } });
});

test("pending, repeated and denied device polls never yield credentials and expired refresh tokens fail", async () => {
  const t = setup();
  const startResponse = await form(t, "device", { client_id: "mcp-agent", resource });
  const device = z.object({ device_code: z.string(), user_code: z.string(), verification_uri_complete: z.string() }).parse(await startResponse.json());
  const requestId = new URL(device.verification_uri_complete).searchParams.get("request");
  if (!requestId) throw new Error("Device request missing");
  const poll = () => form(t, "token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: "mcp-agent", device_code: device.device_code });
  expect(await (await poll()).json()).toEqual({ error: "authorization_pending" });
  expect(await (await poll()).json()).toEqual({ error: "slow_down" });
  const owner = t.withIdentity(identity());
  expect(await owner.mutation(api.mcpConsent.findRequest, { userCode: device.user_code })).toBe(requestId);
  expect(await owner.action(api.mcpConsent.authorize, { requestId, approve: false, organizationIds: [], access: "read" })).toEqual({ redirectUrl: null });
  vi.advanceTimersByTime(15000);
  expect(await (await poll()).json()).toEqual({ error: "access_denied" });
  const connection = await oauth(t);
  vi.advanceTimersByTime(31 * 24 * 60 * 60_000);
  const refreshed = await form(t, "token", { grant_type: "refresh_token", client_id: connection.clientId, refresh_token: connection.refresh_token });
  expect(await refreshed.json()).toEqual({ error: "invalid_grant" });
  expect((await rpc(t, connection.access_token, "tools/list")).status).toBe(401);
});

test("both owners can issue full and read-only keys that see only their approved organization's real data", async () => {
  const t = setup();
  for (const [subject, org] of [["user_alice", "org_one"], ["user_bob", "org_bob"]]) {
    const full = await key(t, { subject, organizationIds: [org], access: "manage" });
    const read = await key(t, { subject, organizationIds: [org], access: "read" });
    const slug = `${subject.replace("_", "-")}-private`;
    await success(t, full.apiKey, "create_event", eventInput(org, slug));
    expect(await success(t, read.apiKey, "get_event", { organizationId: org, slug })).toMatchObject({ slug });
    const mutation = await rpc(t, read.apiKey, "tools/call", { name: "create_event", arguments: eventInput(org, `${slug}-denied`) });
    expect(mutation.status).toBe(403);
    const foreignOrg = org === "org_one" ? "org_bob" : "org_one";
    expect((await call(t, read.apiKey, "list_events", { organizationId: foreignOrg })).value).toEqual({ error: "access_denied" });
  }
  expect((await t.run((ctx) => ctx.db.query("events").collect())).map((event) => event.slug).sort()).toEqual(["user-alice-private", "user-bob-private"]);
});

test("device codes are client bound and expire before consent or token exchange", async () => {
  const t = setup();
  const clientId = await register(t);
  const response = await form(t, "device", { client_id: clientId, resource });
  const device = z.object({ device_code: z.string(), verification_uri_complete: z.string(), expires_in: z.number() }).parse(await response.json());
  const requestId = new URL(device.verification_uri_complete).searchParams.get("request");
  if (!requestId) throw new Error("Device request missing");
  const wrong = await form(t, "token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: "mcp-agent", device_code: device.device_code });
  expect(await wrong.json()).toEqual({ error: "invalid_grant" });
  vi.advanceTimersByTime(device.expires_in * 1000 + 1);
  expect(await t.withIdentity(identity()).query(api.mcpConsent.getRequest, { requestId })).toBeNull();
  const expired = await form(t, "token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: device.device_code });
  expect(await expired.json()).toEqual({ error: "expired_token" });
});

test("component lint allows only the two explicit sensitive reads requiring manage access", async () => {
  const { mcp } = await import("./mcp");
  expect(mcp.lint()).toEqual([
    'Tool "get_submission_contacts" is read-only but requires the write-like scope "events:manage"; read-only connections can\'t use it.',
    'Tool "list_judge_links" is read-only but requires the write-like scope "events:manage"; read-only connections can\'t use it.',
  ]);
});

for (const transport of ["oauth", "apiKey"] as const) {
  test(`${transport} all-organization approval follows future active memberships and keeps selected grants independent`, async () => {
    const t = setup();
    const futureSlug = `future-${transport.toLowerCase()}`;
    const selected = await key(t, { organizationIds: ["org_one", "org_two"] });
    const connection = transport === "oauth" ? await oauth(t, { allOrganizations: true }) : await key(t, { allOrganizations: true });
    const bearer = "access_token" in connection ? connection.access_token : connection.apiKey;
    const owner = t.withIdentity(identity());
    const connections = (await owner.query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 100, cursor: null } })).page;
    const all = connections.find((row) => row.allOrganizations);
    if (!all) throw new Error("All-organization approval missing");
    expect(all).toMatchObject({ organizationIds: [], allOrganizations: true, access: "manage" });
    expect(connections.find((row) => row.id === selected.id)).toMatchObject({ organizationIds: ["org_one", "org_two"] });
    const oldApproval = await t.run(async (ctx) => {
      const id = ctx.db.normalizeId("mcpApprovals", selected.id);
      if (!id) throw new Error("Selected approval missing");
      return ctx.db.get("mcpApprovals", id);
    });
    expect(oldApproval).not.toHaveProperty("allOrganizations");
    expect(await t.run((ctx) => ctx.db.query("mcpApprovalOrganizations").withIndex("by_approvalId_and_organizationId", (q) => q.eq("approvalId", all.id)).collect())).toEqual([]);
    expect(await success(t, bearer, "list_organizations", {})).toEqual({ organizations: [{ id: "org_one", name: "one" }, { id: "org_two", name: "two" }], nextCursor: null, hasMore: false });
    memberships.get("user_alice")?.push(
      { user_id: "user_alice", organization_id: "org_three", organization_name: "Three", status: "active" },
      { user_id: "user_alice", organization_id: "org_pending", organization_name: "Pending", status: "pending" },
      { user_id: "user_alice", organization_id: "org_inactive", organization_name: "Inactive", status: "inactive" },
      { user_id: "user_bob", organization_id: "org_bob", organization_name: "Bob", status: "active" },
    );
    expect(await success(t, bearer, "list_organizations", {})).toEqual({ organizations: [{ id: "org_one", name: "one" }, { id: "org_two", name: "two" }, { id: "org_three", name: "Three" }], nextCursor: null, hasMore: false });
    expect(await success(t, bearer, "create_event", eventInput("org_three", futureSlug))).toMatchObject({ slug: futureSlug });
    expect((await call(t, selected.apiKey, "list_events", { organizationId: "org_three" })).value).toEqual({ error: "access_denied" });
    for (const org of ["org_bob", "org_unknown", "org_pending", "org_inactive"]) {
      expect((await call(t, bearer, "list_events", { organizationId: org })).value).toEqual({ error: "access_denied" });
    }
    memberships.set("user_alice", [{ user_id: "user_alice", organization_id: "org_one", organization_name: "one", status: "active" }]);
    expect(await success(t, bearer, "list_organizations", {})).toEqual({ organizations: [{ id: "org_one", name: "one" }], nextCursor: null, hasMore: false });
    expect((await call(t, bearer, "get_event", { organizationId: "org_three", slug: futureSlug })).value).toEqual({ error: "access_denied" });
    providerAvailable = false;
    for (const [name, args] of [["list_organizations", {}], ["create_event", eventInput("org_one", "provider-must-deny")]] as const) {
      const failed = await call(t, bearer, name, args);
      expect(failed.value).toEqual({ error: "provider_unavailable" });
      expect(JSON.stringify(failed)).not.toContain("private-provider-key");
      expect(JSON.stringify(failed)).not.toContain("private-contact@example.com");
    }
    providerAvailable = true;
    memberships.set("user_alice", []);
    expect(await success(t, bearer, "list_organizations", {})).toEqual({ organizations: [], nextCursor: null, hasMore: false });
    expect((await call(t, bearer, "list_events", { organizationId: "org_one" })).value).toEqual({ error: "access_denied" });
    await owner.mutation(api.mcpConsent.revokeConnection, { id: all.id });
    expect((await rpc(t, bearer, "tools/list")).status).toBe(401);
    expect((await listed(t, selected.apiKey))).toHaveLength(60);
    expect((await t.run((ctx) => ctx.db.query("events").collect())).map((event) => event.slug)).toEqual([futureSlug]);
  });

  test(`${transport} all-organization read consent never widens permissions as membership grows`, async () => {
    const t = setup();
    const connection = transport === "oauth" ? await oauth(t, { allOrganizations: true, access: "read" }) : await key(t, { allOrganizations: true, access: "read" });
    const bearer = "access_token" in connection ? connection.access_token : connection.apiKey;
    memberships.get("user_alice")?.push({ user_id: "user_alice", organization_id: "org_three", organization_name: "Three", status: "active" });
    expect(await success(t, bearer, "list_events", { organizationId: "org_three" })).toMatchObject({ page: [] });
    const response = await rpc(t, bearer, "tools/call", { name: "create_event", arguments: eventInput("org_three", "read-must-deny") });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "insufficient_scope" });
    expect((await listed(t, bearer)).some((tool) => ["create_event", "get_submission_contacts", "list_judge_links"].includes(tool.name))).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toEqual([]);
  });

  test(`${transport} consent rejects contradictory, empty selected and membershipless all grants without creating approvals`, async () => {
    const t = setup();
    const issue = async (options: Parameters<typeof key>[1]) => transport === "oauth" ? approve(t, await start(t), options) : key(t, options);
    await expect(issue({ allOrganizations: true, organizationIds: ["org_one"] })).rejects.toThrow("Choose either all organizations or specific organizations.");
    await expect(issue({ organizationIds: [] })).rejects.toThrow("Choose organizations you currently belong to.");
    memberships.set("user_alice", [{ user_id: "user_alice", organization_id: "org_pending", organization_name: "Pending", status: "pending" }]);
    await expect(issue({ allOrganizations: true })).rejects.toThrow("You must currently belong to an organization.");
    expect(await t.run((ctx) => ctx.db.query("mcpApprovals").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("mcpApprovalOrganizations").collect())).toEqual([]);
  });
}


test("internal key approval rejects conflicting organization policies atomically", async () => {
  const t = setup();
  await expect(t.mutation(internal.mcpConsent.insertApiKey, {
    ownerAccountKey: "workos:client_test:user_alice", workosUserId: "user_alice", actor: "alice",
    name: "Conflicting selection", hash: "unused", resource,
    allOrganizations: true, organizationIds: ["org_one"], access: "read",
  })).rejects.toThrow("Choose either all organizations or specific organizations.");
  expect(await t.run((ctx) => ctx.db.query("mcpApprovals").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("mcpApprovalOrganizations").collect())).toEqual([]);
});


test("connection pagination keeps older active grants reachable after unused approvals", async () => {
  const t = setup();
  const oldest = await key(t, { name: "Old active connection" });
  await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("mcpApprovals", oldest.id);
    const original = id ? await ctx.db.get("mcpApprovals", id) : null;
    if (!original) throw new Error("Approval missing");
    for (let i = 0; i < 125; i++) await ctx.db.insert("mcpApprovals", {
      ownerAccountKey: original.ownerAccountKey, workosUserId: original.workosUserId, actor: original.actor,
      source: "oauth", name: `Unused ${i}`, access: "read", requestedScopes: ["events:read"], approvedScopes: ["events:read"],
      ...(i % 2 === 0 ? { revokedAt: Date.now() } : {}),
    });
  });
  const newest = await key(t, { name: "New active connection" });
  const other = await key(t, { subject: "user_bob", organizationIds: ["org_bob"] });
  const owner = t.withIdentity(identity());
  let cursor: string | null = null;
  const found: string[] = [];
  let pages = 0;
  do {
    const response: FunctionReturnType<typeof api.mcpConsent.listConnections> = await owner.query(api.mcpConsent.listConnections, { paginationOpts: { numItems: 20, cursor } });
    found.push(...response.page.map((connection) => connection.id));
    pages++;
    cursor = response.isDone ? null : response.continueCursor;
  } while (cursor);
  expect(pages).toBeGreaterThan(5);
  expect(found).toEqual([newest.id, oldest.id]);
  expect(found).not.toContain(other.id);
  await owner.mutation(api.mcpConsent.revokeConnection, { id: oldest.id });
  expect((await rpc(t, oldest.apiKey, "tools/list")).status).toBe(401);
  expect((await listed(t, newest.apiKey))).toHaveLength(60);
});
