import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { activeMemberships, mcpConfig, verifyConnectUser } from "./mcpAuth";
import { DEFAULT_EVENT_THEME } from "../lib/event-theme";
import { ADMIN_TOOLS } from "./mcpTools";
import { z } from "zod";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./eventSlugs.ts": () => import("./eventSlugs"),
  "./organizationStyles.ts": () => import("./organizationStyles"),
  "./mcpData.ts": () => import("./mcpData"),
  "./mcpAdmin.ts": () => import("./mcpAdmin"),
  "./judging.ts": () => import("./judging"),
  "./ai.ts": () => import("./ai"),
  "./googleSheets.ts": () => import("./googleSheets"),
  "./http.ts": async () => {
    const { httpRouter } = await import("convex/server");
    const { mcp, metadata } = await import("./mcpWorkos");
    const http = httpRouter();
    for (const method of ["POST", "GET", "DELETE", "OPTIONS"] as const) http.route({ path: "/mcp", method, handler: mcp });
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) http.route({ path, method: "GET", handler: metadata });
    return { default: http };
  },
};
const config = { issuer: "https://login.example.com", resource: "https://some.convex.site/mcp", requestOrigin: "https://some.convex.site", apiKey: "private-provider-key" };
const user = { userId: "user_operator", organizationId: "org_one", actor: "https://login.example.com|user_operator" };
const membership = { user_id: "user_operator", organization_id: "org_one", organization_name: "One", status: "active" };
let privateKey: CryptoKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function requiredExample(value: unknown): unknown {
  const schema = z.object({
    type: z.string().optional(), const: z.unknown().optional(),
    anyOf: z.array(z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(), required: z.array(z.string()).optional(),
  }).passthrough().parse(value);
  if ("const" in schema) return schema.const;
  if (schema.anyOf?.[0]) return requiredExample(schema.anyOf[0]);
  switch (schema.type) {
    case "object": return Object.fromEntries((schema.required ?? []).map((name) => [name, requiredExample(schema.properties?.[name])]));
    case "array": return [];
    case "boolean": return false;
    case "number": return 1;
    case "null": return null;
    case "string": return "example";
    default: throw new Error("Unsupported test schema");
  }
}

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ iss: config.issuer, aud: config.resource, sub: user.userId, sid: "documented-consent-id", org_id: "org_one", client_id: "client_test", scope: "openid profile email offline_access", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey);
}

function provider(getMembershipPage: (url: URL) => { data: (typeof membership)[]; list_metadata: { after: string | null } } = () => ({ data: [membership], list_metadata: { after: null } })) {
  vi.stubEnv("WORKOS_MCP_ISSUER", config.issuer);
  vi.stubEnv("WORKOS_MCP_RESOURCE", config.resource);
  vi.stubEnv("WORKOS_API_KEY", config.apiKey);
  vi.stubGlobal("fetch", vi.fn(async (input: URL | Request | string) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === `${config.issuer}/oauth2/jwks`) return Response.json({ keys: [publicJwk] });
    if (url.origin !== "https://api.workos.com") throw new Error("unexpected provider");
    return Response.json(getMembershipPage(url));
  }));
}

async function request(t: ReturnType<typeof convexTest>, bearer: string, method: string, params: unknown, headers: Record<string, string> = {}) {
  return t.fetch("/mcp", {
    method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

test("official SDK serves initialize, discovery, and safe calls as stateless JSON in the edge runtime", async () => {
  provider();
  const t = convexTest(schema, modules);
  const bearer = await token();
  const initialized = await request(t, bearer, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } });
  expect(initialized.status).toBe(200);
  expect(initialized.headers.get("Content-Type")).toContain("application/json");
  expect(initialized.headers.get("mcp-session-id")).toBeNull();
  expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "demo-queue" }, protocolVersion: "2025-11-25" } });
  const discovered = await request(t, bearer, "tools/list", {});
  const discovery = await discovered.json();
  expect(JSON.stringify(discovery)).toContain('"result"');
  expect(discovery.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["list_organizations","list_events","get_event","create_event","list_styles","create_style","set_default_style","get_event_overview","get_event_admin","get_submission_contacts","add_submission","add_test_submissions","save_judges","change_event_type","request_judging_sheet_sync","update_submission","publish_queue","set_stage_screen_mode","set_submission_count_visible","set_stage_meet_link_visible","set_stage_timer_visible","set_stage_results_show_finalists","set_stage_timer_duration","start_stage_timer","set_demo_timer_visible","set_demo_timer_duration","start_demo_timer","pause_demo_timer","adjust_demo_timer","pause_stage_timer","reset_stage_timer","adjust_stage_timer","hide_submission","restore_submission","reorder_lineup","shuffle_lineup","move_to_pool","set_lineup_target","mark_no_show","advance_presenter","restore_previous_presenter","skip_current_presenter","clear_queue","list_judge_links","create_judge_link","close_submissions","start_assignment_preparation","prepare_assignment_batch","preview_redistribution","apply_redistribution","get_judging_progress","set_judging_timer","start_judging","add_judging_time","close_judging","reopen_judging","get_judging_timer","get_normalization_overview","save_normalization_decision","ai_shuffle","create_judging_sheet","preview_phase_change","set_phase","reopen_submissions","set_judging_time_left","pause_judging_timer","resume_judging_timer","set_stage_timer_remaining","list_recent_changes","undo_change","get_judges_overview","replace_judge_link","move_judge_scores","add_judges","remove_judge","rename_judge","set_judge_link_active","get_live_event","create_practice_event","list_practice_events","add_practice_submissions","score_as_test_judges","skip_practice_timer","set_practice_ai_summaries","reset_practice_event"]);
  const called = await request(t, bearer, "tools/call", { name: "list_events", arguments: { organizationId: "org_one" } });
  expect(JSON.parse((await called.json()).result.content[0].text)).toEqual({ page: [], isDone: true, continueCursor: "_end_cursor" });
  const modern = await request(t, bearer, "tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
  expect(modern.headers.get("Content-Type")).toContain("application/json");
  const modernBody = await modern.json();
  expect(JSON.stringify(modernBody)).toContain('"result"');
  expect(modernBody.result.tools.map((tool: { name: string }) => tool.name)).toContain("create_style");
});

test("all 78 added tools deny foreign organization selection and revoked membership before domain effects", async () => {
  let active = true;
  provider(() => ({ data: active ? [membership] : [], list_metadata: { after: null } }));
  const t = convexTest(schema, modules);
  const bearer = await token();
  const discovery = await (await request(t, bearer, "tools/list", {})).json();
  const tools = z.array(z.object({ name: z.string(), inputSchema: z.unknown() })).parse(discovery.result.tools);
  const names = new Set(ADMIN_TOOLS.map((tool) => tool.name));
  expect(names.size).toBe(78);
  for (const tool of tools.filter((tool) => names.has(tool.name))) {
    const example = z.record(z.string(), z.unknown()).parse(requiredExample(tool.inputSchema));
    const foreign = await (await request(t, bearer, "tools/call", { name: tool.name, arguments: { ...example, organizationId: "org_two" } })).json();
    expect(JSON.parse(foreign.result.content[0].text), tool.name).toEqual({ error: "reauthorization_required" });
    active = false;
    const revoked = await (await request(t, bearer, "tools/call", { name: tool.name, arguments: { ...example, organizationId: "org_one" } })).json();
    expect(JSON.parse(revoked.result.content[0].text), tool.name).toEqual({ error: "membership_required" });
    active = true;
  }
  expect(await t.run((ctx) => ctx.db.query("events").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("submissions").collect())).toEqual([]);
});

test("signed HTTP tools persist a complete organizer workflow without exposing participant authority", async () => {
  provider();
  const t = convexTest(schema, modules);
  const bearer = await token();
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await request(t, bearer, "tools/call", { name, arguments: { organizationId: "org_one", ...args } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  };
  const event = await call("create_event", { name: "HTTP operator", slug: "http-operator", eventType: "demo", meetUrl: "https://meet.example.com" });
  const added = await call("add_submission", { slug: event.slug, name: "Sam", demoTitle: "HTTP demo", description: "Live control", phone: "+447700900000", email: "private@example.com", queueOrder: 0 });
  await call("set_lineup_target", { slug: event.slug, target: 4 });
  await call("publish_queue", { slug: event.slug });
  await call("start_stage_timer", { slug: event.slug, durationMs: 180000 });
  await call("pause_stage_timer", { slug: event.slug });
  await call("start_demo_timer", { slug: event.slug });
  await call("pause_demo_timer", { slug: event.slug });
  const admin = await call("get_event_admin", { slug: event.slug });
  expect(admin.event).toMatchObject({ queuePublished: true, lineupTarget: 4 });
  expect(admin.lineup).toMatchObject([{ id: added.submissionId, demoTitle: "HTTP demo" }]);
  expect(JSON.stringify(admin)).not.toContain("private@example.com");
  expect(JSON.stringify(admin)).not.toContain("participantToken");
  const contacts = await call("get_submission_contacts", { slug: event.slug, submissionId: added.submissionId });
  expect(contacts.email).toBe("private@example.com");
  await call("advance_presenter", { slug: event.slug });
  expect((await call("get_event_admin", { slug: event.slug })).completed).toHaveLength(1);
  await call("restore_previous_presenter", { slug: event.slug });
  expect((await call("get_event_admin", { slug: event.slug })).lineup).toHaveLength(1);
  const saved = await t.run((ctx) => ctx.db.query("submissions").first());
  expect(saved?.participantToken).toMatch(/^[0-9a-f-]{36}$/);
  const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(audit.length).toBeGreaterThan(4);
  expect(audit.every((row) => row.actor === user.actor)).toBe(true);
  const denied = await (await request(t, bearer, "tools/call", { name: "get_event_admin", arguments: { organizationId: "org_one", slug: "does-not-exist" } })).json();
  expect(JSON.parse(denied.result.content[0].text)).toEqual({ error: "access_denied" });
});

test("JWT verification rejects issuer, audience, expiry, missing consent, machine identity, missing organization, and invalid signatures", async () => {
  provider();
  expect(await verifyConnectUser(await token(), config)).toEqual(user);
  for (const claims of [{ iss: "https://wrong.example.com" }, { aud: "client_test" }, { aud: [config.resource, "other"] }, { exp: 1 }, { sid: undefined }, { sub: "client_machine" }, { org_id: undefined }, { iss: "https://api.workos.com/user_management/client_test" }]) {
    await expect(verifyConnectUser(await token(claims), config)).rejects.toThrow("invalid_token");
  }
  const wrong = await generateKeyPair("RS256");
  const badSignature = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(wrong.privateKey);
  await expect(verifyConnectUser(badSignature, config)).rejects.toThrow("invalid_token");
});

test("HTTP boundary supplies OAuth discovery and rejects unauthorized, expired, foreign origin, query credentials, and oversized requests", async () => {
  provider();
  const t = convexTest(schema, modules);
  const metadata = await t.fetch("/.well-known/oauth-protected-resource/mcp");
  expect(await metadata.json()).toMatchObject({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: ["openid", "profile", "email", "offline_access"] });
  const missing = await t.fetch("/mcp", { method: "POST" });
  expect(missing.status).toBe(401);
  expect(missing.headers.get("WWW-Authenticate")).toBe('Bearer resource_metadata="https://some.convex.site/.well-known/oauth-protected-resource/mcp"');
  expect((await request(t, await token({ exp: 1 }), "tools/list", {})).status).toBe(401);
  expect((await request(t, await token(), "tools/list", {}, { Origin: "https://attacker.example" })).status).toBe(403);
  expect((await request(t, await token(), "tools/list", {}, { Host: "attacker.example" })).status).toBe(403);
  expect((await t.fetch("/mcp?access_token=secret", { method: "POST" })).status).toBe(403);
  const oversized = await request(t, await token(), "tools/call", { name: "create_style", arguments: { name: "x".repeat(300000) } });
  expect([400, 413]).toContain(oversized.status);
});

test("public resource discovery and authenticated calls work through trusted Convex ingress", async () => {
  provider();
  const publicResource = "https://hack.outpostcrew.co/mcp";
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  vi.stubEnv("WORKOS_MCP_RESOURCE", publicResource);
  const t = convexTest(schema, modules);
  for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
    const discovery = await t.fetch(path);
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({ resource: publicResource, authorization_servers: [config.issuer] });
  }
  const missing = await t.fetch("/mcp", { method: "POST" });
  expect(missing.status).toBe(401);
  expect(missing.headers.get("WWW-Authenticate")).toBe('Bearer resource_metadata="https://hack.outpostcrew.co/.well-known/oauth-protected-resource/mcp"');
  const bearer = await token({ aud: publicResource });
  const response = await request(t, bearer, "tools/call", { name: "list_events", arguments: { organizationId: "org_one" } }, { Origin: "https://hack.outpostcrew.co" });
  expect(response.status).toBe(200);
  expect(JSON.parse((await response.json()).result.content[0].text)).toMatchObject({ page: [], isDone: true });
  expect((await request(t, await token(), "tools/list", {})).status).toBe(401);
  const maliciousHeaders: Record<string, string>[] = [
    { Origin: "https://attacker.example", "X-Forwarded-Host": "hack.outpostcrew.co" },
    { Host: "hack.outpostcrew.co", "X-Forwarded-Host": "some.convex.site" },
    { Host: "attacker.example", Origin: "https://hack.outpostcrew.co" },
  ];
  for (const headers of maliciousHeaders) {
    expect((await request(t, bearer, "tools/list", {}, headers)).status).toBe(403);
  }
  expect((await t.fetch("/mcp?access_token=secret", { method: "POST" })).status).toBe(403);
});

test("every tool call checks current membership and binds arguments to the OAuth organization", async () => {
  let active = true;
  provider(() => ({ data: active ? [membership] : [], list_metadata: { after: null } }));
  const t = convexTest(schema, modules);
  const bearer = await token();
  const call = (organizationId: string) => request(t, bearer, "tools/call", { name: "list_styles", arguments: { organizationId } });
  expect(JSON.stringify(await (await call("org_one")).json())).toContain('presets');
  expect(JSON.stringify(await (await call("org_two")).json())).toContain("reauthorization_required");
  active = false;
  expect(JSON.stringify(await (await call("org_one")).json())).toContain("membership_required");
  provider(() => { throw new Error("private-provider-key private-contact@example.com"); });
  const unavailable = JSON.stringify(await (await call("org_one")).json());
  expect(unavailable).toContain("provider_unavailable");
  expect(unavailable).not.toContain("private-provider-key");
  expect(unavailable).not.toContain("private-contact@example.com");
  await expect(activeMemberships(user, config)).rejects.toThrow("provider_unavailable");
});

test("organization discovery follows provider cursors independently of the selected organization and denies revoked membership", async () => {
  let active = true;
  const pageOne = Array.from({ length: 100 }, (_, index) => ({ ...membership, organization_id: `org_page${index}`, organization_name: `Page ${index}` }));
  const cursor = "page/2?opaque=cursor&value=+";
  const requests: URL[] = [];
  provider((url) => {
    requests.push(url);
    if (url.searchParams.get("organization_id") === "org_one") {
      return { data: active ? [membership] : [], list_metadata: { after: null } };
    }
    return url.searchParams.get("after") === cursor
      ? { data: [{ ...membership, organization_id: "org_last", organization_name: "Last" }], list_metadata: { after: null } }
      : { data: pageOne, list_metadata: { after: cursor } };
  });
  const t = convexTest(schema, modules);
  const bearer = await token();
  const call = async (args: unknown) => (await request(t, bearer, "tools/call", { name: "list_organizations", arguments: args })).json();
  const first = JSON.parse((await call({})).result.content[0].text);
  expect(first).toEqual({ organizations: pageOne.map((item) => ({ id: item.organization_id, name: item.organization_name })), selectedOrganizationId: "org_one", nextCursor: cursor, hasMore: true });
  const second = JSON.parse((await call({ cursor: first.nextCursor })).result.content[0].text);
  expect(second).toEqual({ organizations: [{ id: "org_last", name: "Last" }], selectedOrganizationId: "org_one", nextCursor: null, hasMore: false });
  expect(requests.map((url) => ({ organizationId: url.searchParams.get("organization_id"), after: url.searchParams.get("after") }))).toEqual([
    { organizationId: "org_one", after: null }, { organizationId: null, after: null },
    { organizationId: "org_one", after: null }, { organizationId: null, after: cursor },
  ]);
  active = false;
  const revoked = await call({ cursor });
  expect(revoked.result.isError).toBe(true);
  expect(JSON.parse(revoked.result.content[0].text)).toEqual({ error: "membership_required" });
  expect(requests).toHaveLength(5);
});

test("organization discovery rejects invalid cursors through its SDK input schema", async () => {
  provider();
  const t = convexTest(schema, modules);
  const bearer = await token();
  for (const cursor of ["", "x".repeat(4097), 123, {}]) {
    const response = await request(t, bearer, "tools/call", { name: "list_organizations", arguments: { cursor } });
    expect((await response.json()).result.isError).toBe(true);
  }
  const response = await request(t, bearer, "tools/call", { name: "list_organizations", arguments: { cursor: null } });
  expect(JSON.parse((await response.json()).result.content[0].text)).toEqual({ organizations: [{ id: "org_one", name: "One" }], selectedOrganizationId: "org_one", nextCursor: null, hasMore: false });
});

test("SDK tool calls persist styles and events while validation and provider errors remain sanitized", async () => {
  provider();
  const t = convexTest(schema, modules);
  const bearer = await token();
  const call = async (name: string, args: unknown) => (await request(t, bearer, "tools/call", { name, arguments: args })).json();
  const styleResponse = await call("create_style", { organizationId: "org_one", name: "Night", theme: DEFAULT_EVENT_THEME });
  const savedStyle = JSON.parse(styleResponse.result.content[0].text);
  expect(savedStyle).toMatchObject({ name: "Night", isDefault: false });
  const eventResponse = await call("create_event", { organizationId: "org_one", name: "Night event", slug: "sdk-created", eventType: "demo", meetUrl: "https://meet.google.com/example", style: { kind: "saved", id: savedStyle.id } });
  const savedEvent = JSON.parse(eventResponse.result.content[0].text);
  expect(savedEvent).toMatchObject({ name: "Night event", queuePublished: false, theme: DEFAULT_EVENT_THEME });
  expect(JSON.parse((await call("get_event", { organizationId: "org_one", slug: "sdk-created" })).result.content[0].text)).toEqual(savedEvent);
  expect(JSON.parse((await call("set_default_style", { organizationId: "org_one", selection: { kind: "saved", id: savedStyle.id } })).result.content[0].text)).toEqual({ organizationId: "org_one", styleId: savedStyle.id });
  const invalid = await call("create_style", { organizationId: "org_one", name: "Invalid", theme: { ...DEFAULT_EVENT_THEME, font: "private-contact@example.com" } });
  expect(invalid.result.isError).toBe(true);
  expect(JSON.stringify(invalid)).not.toContain("private-contact@example.com");
  const duplicate = await call("create_event", { organizationId: "org_one", name: "Duplicate", slug: "sdk-created", eventType: "demo", meetUrl: "https://meet.google.com/example" });
  expect(JSON.parse(duplicate.result.content[0].text)).toEqual({ error: "operation_failed" });
});

test("MCP creates nondefault styles and unpublished events with isolated snapshots and safe readback", async () => {
  const t = convexTest(schema, modules);
  const style = await t.mutation(internal.mcpData.createStyle, { organizationId: "org_one", name: "Midnight", theme: { ...DEFAULT_EVENT_THEME, accent: "#224466" } });
  expect(style).toMatchObject({ name: "Midnight", isDefault: false, theme: { accent: "#224466" } });
  const created = await t.mutation(internal.mcpData.createEvent, { expectedOrganizationId: "org_one", actor: user.actor, name: "Night", slug: "night", eventType: "demo", meetUrl: "https://meet.google.com/example", styleId: style.id });
  expect(created).toMatchObject({ slug: "night", queuePublished: false, theme: { accent: "#224466" } });
  const browser = t.withIdentity({ subject: "user_operator", org_id: "org_one" });
  await browser.mutation(api.organizationStyles.save, { expectedOrganizationId: "org_one", id: style.id, name: "Edited", theme: { ...DEFAULT_EVENT_THEME, accent: "#aa1122" }, isDefault: false });
  expect(await t.query(internal.mcpData.getEvent, { organizationId: "org_one", slug: "night" })).toEqual(created);
  expect(await t.query(internal.mcpData.getEvent, { organizationId: "org_two", slug: "night" })).toBeNull();
  expect((await t.query(internal.mcpData.listEvents, { organizationId: "org_two", paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([]);
  await expect(t.mutation(internal.mcpData.createEvent, { expectedOrganizationId: "org_two", actor: user.actor, name: "Foreign", slug: "foreign", eventType: "demo", meetUrl: "https://meet.google.com/example", styleId: style.id })).rejects.toThrow("Style not found");
  await t.mutation(internal.mcpData.setDefaultStyle, { organizationId: "org_one", selection: { kind: "saved", id: style.id } });
  expect((await t.query(internal.mcpData.listStyles, { organizationId: "org_one" })).styles).toMatchObject([{ id: style.id, isDefault: true }]);
  await expect(t.mutation(internal.mcpData.setDefaultStyle, { organizationId: "org_two", selection: { kind: "saved", id: style.id } })).rejects.toThrow("Style not found");
  const serialized = JSON.stringify(created);
  for (const field of ["adminToken", "participantToken", "judge", "phone", "email", "contact", "meetUrl"]) expect(serialized).not.toContain(field);
  expect(await t.run((ctx) => ctx.db.get(created.id))).not.toHaveProperty("adminToken");
});

test("MCP resolves renamed event aliases without changing organization authority or releasing old slugs", async () => {
  provider();
  const t = convexTest(schema, modules);
  const bearer = await token();
  const created = await t.mutation(internal.mcpData.createEvent, {
    expectedOrganizationId: "org_one", actor: user.actor, name: "Daytona", slug: "old-test-name",
    eventType: "hackathon", meetUrl: "https://meet.google.com/example",
  });
  await t.mutation(internal.eventSlugs.rename, {
    eventId: created.id, expectedSlug: "old-test-name", expectedOrganizationId: "org_one",
    newSlug: "daytona-hacksprint", dryRun: false,
  });
  const call = async (name: string, args: unknown) => (await request(t, bearer, "tools/call", { name, arguments: args })).json();
  for (const slug of ["old-test-name", "daytona-hacksprint"]) {
    const response = await call("get_event", { organizationId: "org_one", slug });
    expect(JSON.parse(response.result.content[0].text)).toEqual({ ...created, slug: "daytona-hacksprint" });
    expect(await t.query(internal.mcpData.getEvent, { organizationId: "org_two", slug })).toBeNull();
  }
  const foreign = await call("get_event", { organizationId: "org_two", slug: "old-test-name" });
  expect(foreign.result.isError).toBe(true);
  expect(JSON.parse(foreign.result.content[0].text)).toEqual({ error: "reauthorization_required" });
  const duplicate = await call("create_event", {
    organizationId: "org_one", name: "Collision", slug: "old-test-name",
    eventType: "demo", meetUrl: "https://meet.google.com/example",
  });
  expect(duplicate.result.isError).toBe(true);
  expect(JSON.parse(duplicate.result.content[0].text)).toEqual({ error: "operation_failed" });
  expect(await t.run((ctx) => ctx.db.query("events").take(10))).toHaveLength(1);
});

test("style creation enforces structured tokens, limits, and leaves defaults unchanged", async () => {
  const t = convexTest(schema, modules);
  const initial = await t.query(internal.mcpData.listStyles, { organizationId: "org_one" });
  expect(initial.presets.filter((preset) => preset.isDefault).map((preset) => preset.preset)).toEqual(["neutral"]);
  const input = { organizationId: "org_one", name: "Safe", theme: DEFAULT_EVENT_THEME };
  await expect(t.mutation(internal.mcpData.createStyle, { ...input, theme: { ...DEFAULT_EVENT_THEME, background: "url(https://evil.example)" } })).rejects.toThrow("hex colors");
  await expect(t.mutation(internal.mcpData.createStyle, { ...input, theme: { ...DEFAULT_EVENT_THEME, radius: 25 } })).rejects.toThrow("radius");
  await t.mutation(internal.mcpData.setDefaultStyle, { organizationId: "org_one", selection: { kind: "preset", preset: "outpost" } });
  await t.run(async (ctx) => { for (let i = 0; i < 100; i++) await ctx.db.insert("organizationStyles", { organizationId: "org_one", name: `Style ${i}`, theme: DEFAULT_EVENT_THEME, isDefault: false, updatedAt: 1 }); });
  await expect(t.mutation(internal.mcpData.createStyle, input)).rejects.toThrow("100 styles");
  const listed = await t.query(internal.mcpData.listStyles, { organizationId: "org_one" });
  expect(listed.presets.find((preset) => preset.isDefault)?.preset).toBe("outpost");
  expect(listed.styles).toHaveLength(100);
});

test("config derives only the built-in deployment resource and rejects insecure URLs", () => {
  expect(mcpConfig({ WORKOS_MCP_ISSUER: config.issuer, CONVEX_SITE_URL: "https://some.convex.site", WORKOS_API_KEY: "key" }).resource).toBe(config.resource);
  expect(() => mcpConfig({ WORKOS_MCP_ISSUER: config.issuer, WORKOS_MCP_RESOURCE: "http://example.com/mcp", WORKOS_API_KEY: "key" })).toThrow("provider_unavailable");
  expect(mcpConfig({ WORKOS_MCP_ISSUER: config.issuer, WORKOS_MCP_RESOURCE: "https://hack.outpostcrew.co/mcp", CONVEX_SITE_URL: "https://some.convex.site", WORKOS_API_KEY: "key" })).toMatchObject({ resource: "https://hack.outpostcrew.co/mcp", requestOrigin: "https://some.convex.site" });
  for (const ingress of ["http://some.convex.site", "https://user@some.convex.site", "https://some.convex.site/path", "https://some.convex.site?extra=1", "https://some.convex.site/#fragment"]) {
    expect(() => mcpConfig({ WORKOS_MCP_ISSUER: config.issuer, WORKOS_MCP_RESOURCE: config.resource, CONVEX_SITE_URL: ingress, WORKOS_API_KEY: "key" })).toThrow("provider_unavailable");
  }
});
