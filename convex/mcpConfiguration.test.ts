import { convexTest } from "convex-test";
import component from "@convex-dev/mcp/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { api } from "./_generated/api";
import { componentConfiguration, componentSiteUrl } from "./mcpConnectionPolicy";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./convex.config.ts"]);
const development = "https://precious-elk-564.convex.site";
const production = "https://giant-egret-456.convex.site";
const publicSite = "https://hack.outpostcrew.co";
const redirectUri = "https://agent.example/callback";
const verifier = "v".repeat(64);
const identity = { subject: "user_alice", issuer: "https://api.workos.com/user_management/client_test" };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_SITE_URL", development);
  vi.stubEnv("MCP_CONSENT_URL", undefined);
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  vi.stubEnv("WORKOS_API_KEY", "private-test-key");
  vi.stubGlobal("fetch", vi.fn(async (input: URL | Request | string) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://api.workos.com") throw new Error("Unexpected provider");
    return Response.json({ data: [{ user_id: "user_alice", organization_id: "org_one", organization_name: "One", status: "active" }], list_metadata: { after: null } });
  }));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("canonical deployment configuration fixes the production public origin and keeps development consent", () => {
  expect(componentConfiguration()).toEqual({ siteUrl: development, consentUrl: "http://localhost:3002/events/connect", allowedOrigins: ["http://localhost:3002"] });
  vi.stubEnv("MCP_CONSENT_URL", "https://preview.example/events/connect");
  expect(componentConfiguration()).toEqual({ siteUrl: development, consentUrl: "https://preview.example/events/connect", allowedOrigins: ["http://localhost:3002", "https://preview.example"] });
  vi.stubEnv("CONVEX_SITE_URL", production);
  vi.stubEnv("MCP_CONSENT_URL", "https://attacker.example/events/connect");
  expect(componentConfiguration()).toEqual({ siteUrl: publicSite, consentUrl: `${publicSite}/events/connect`, allowedOrigins: [publicSite] });
});

test("component configuration rejects noncanonical deployments and URL normalization tricks", () => {
  for (const site of [undefined, "", publicSite, "https://wrong.convex.site", "https://giant-egret-456.convex.cloud", "http://giant-egret-456.convex.site", `${production}/`, `${production}/path`, `${production}?redirect=evil`, `${production}#fragment`, "https://user:secret@giant-egret-456.convex.site", "https://giant-egret-456.convex.site.attacker.example", "https://GIANT-EGRET-456.convex.site", "https://giant-egret-456.convex.site:443"]) {
    vi.stubEnv("CONVEX_SITE_URL", site);
    expect(() => componentSiteUrl()).toThrow("canonical");
    expect(() => componentConfiguration()).toThrow("canonical");
  }
});

test("development consent rejects credentials, insecure remote origins and alternate paths", () => {
  for (const consent of ["http://remote.example/events/connect", "http://localhost:3003/events/connect", "https://user:secret@preview.example/events/connect", "https://preview.example/events/connect?returnTo=evil", "https://preview.example/events/connect#evil", "https://preview.example/elsewhere", "https://preview.example/other/../events/connect", "https://preview.example:443/events/connect"]) {
    vi.stubEnv("MCP_CONSENT_URL", consent);
    expect(() => componentConfiguration()).toThrow("Invalid MCP consent URL");
  }
});

test.each([
  { backend: production, site: publicSite, consent: `${publicSite}/events/connect`, origin: publicSite },
  { backend: development, site: development, consent: "http://localhost:3002/events/connect", origin: "http://localhost:3002" },
])("$site advertises and enforces one OAuth resource through the registered component routes", async ({ backend, site, consent, origin }) => {
  vi.stubEnv("CONVEX_SITE_URL", backend);
  const resource = `${site}/mcp`;
  const t = convexTest(schema, modules);
  component.register(t);
  const spoofedHeaders = { "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "http", Forwarded: "host=attacker.example;proto=http" };
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const response = await t.fetch(path, { headers: spoofedHeaders });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource, authorization_servers: [site], scopes_supported: ["events:read", "events:manage"] });
  }
  const metadata = await t.fetch("/.well-known/oauth-authorization-server", { headers: spoofedHeaders });
  expect(await metadata.json()).toMatchObject({ issuer: site, authorization_endpoint: `${resource}/oauth/authorize`, token_endpoint: `${resource}/oauth/token`, registration_endpoint: `${resource}/oauth/register`, revocation_endpoint: `${resource}/oauth/revoke`, device_authorization_endpoint: `${resource}/oauth/device` });
  const unauthorized = await t.fetch("/mcp", { method: "POST", headers: { ...spoofedHeaders, Origin: origin } });
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get("WWW-Authenticate")).toContain(`resource_metadata="${site}/.well-known/oauth-protected-resource/mcp"`);
  expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect((await t.fetch("/mcp", { method: "POST" })).status).toBe(401);
  const blocked = await t.fetch("/mcp", { method: "POST", headers: { Origin: "https://attacker.example" } });
  expect(blocked.status).toBe(403);
  const preflight = await t.fetch("/mcp", { method: "OPTIONS", headers: { Origin: origin } });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  if (backend === production) {
    expect((await t.fetch("/mcp", { method: "POST", headers: { Origin: "http://localhost:3002" } })).status).toBe(403);
  }

  const registered = await t.fetch("/mcp/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Public agent", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) });
  expect(registered.status).toBe(201);
  const clientId = z.object({ client_id: z.string() }).parse(await registered.json()).client_id;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", resource, scope: "events:read", state: "test-state" });
  const wrongAudience = backend === production ? `${backend}/mcp` : "https://wrong.convex.site/mcp";
  const wrongParams = new URLSearchParams(params);
  wrongParams.set("resource", wrongAudience);
  const wrongAuthorization = await t.fetch(`/mcp/oauth/authorize?${wrongParams}`);
  const wrongLocation = wrongAuthorization.headers.get("Location");
  if (!wrongLocation) throw new Error("Missing audience rejection redirect");
  expect(new URL(wrongLocation).searchParams.get("error")).toBe("invalid_target");
  expect(new URL(wrongLocation).searchParams.get("iss")).toBe(site);
  const authorization = await t.fetch(`/mcp/oauth/authorize?${params}`, { headers: spoofedHeaders });
  expect(authorization.status).toBe(302);
  const location = authorization.headers.get("Location");
  if (!location) throw new Error("Missing consent redirect");
  const consentUrl = new URL(location);
  expect(consentUrl.origin + consentUrl.pathname).toBe(consent);
  const requestId = consentUrl.searchParams.get("request");
  if (!requestId) throw new Error("Missing authorization request");
  const approved = await t.withIdentity(identity).action(api.mcpConsent.authorize, { requestId, approve: true, organizationIds: ["org_one"], access: "read" });
  if (!approved.redirectUrl) throw new Error("Missing client redirect");
  const callback = new URL(approved.redirectUrl);
  expect(callback.searchParams.get("iss")).toBe(site);
  expect(callback.searchParams.get("state")).toBe("test-state");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Missing authorization code");
  const exchange = { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource };
  const form = (endpoint: string, values: Record<string, string>) => t.fetch(`/mcp/oauth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() });
  const rejected = await form("token", { ...exchange, resource: wrongAudience });
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: "invalid_target" });
  const exchanged = await form("token", exchange);
  expect(exchanged.status).toBe(200);
  const tokens = z.object({ access_token: z.string(), refresh_token: z.string(), token_type: z.literal("Bearer") }).parse(await exchanged.json());
  const rpc = () => t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18", Origin: origin }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const listed = await rpc();
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({ result: { tools: expect.arrayContaining([expect.objectContaining({ name: "list_events" })]) } });
  const refreshed = await form("token", { grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource });
  expect(refreshed.status).toBe(200);
  const revoked = await form("revoke", { token: tokens.access_token, client_id: clientId });
  expect(revoked.status).toBe(200);
  expect((await rpc()).status).toBe(401);
  const device = await form("device", { client_id: "mcp-agent", resource, scope: "events:read" });
  expect(device.status).toBe(200);
  expect(await device.json()).toMatchObject({ verification_uri: consent });
  const key = await t.withIdentity(identity).action(api.mcpConsent.createApiKey, { name: "Public key", organizationIds: ["org_one"], access: "read" });
  expect(key.url).toBe(resource);
});
