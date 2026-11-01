import { convexTest } from "convex-test";
import component from "@convex-dev/mcp/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./convex.config.ts"]);

function setup() {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  const t = convexTest(schema, modules);
  component.register(t);
  rateLimiterTest.register(t);
  return t;
}
afterEach(() => { vi.unstubAllEnvs(); });
const person = (subject: string, org: string) => ({ subject, issuer: "https://api.workos.com/user_management/client_test", org_id: org, tokenIdentifier: `https://api.workos.com/user_management/client_test|${subject}` });

test("hiding the guide is saved per person and per organization", async () => {
  const t = setup();
  const alice = t.withIdentity(person("user_alice", "org_one"));
  expect(await alice.query(api.gettingStarted.status, {})).toMatchObject({ organizationId: "org_one", hidden: false, dryRunMarked: false, testPeopleAdded: false, connected: false });
  await alice.mutation(api.gettingStarted.setHidden, { hidden: true });
  expect(await alice.query(api.gettingStarted.status, {})).toMatchObject({ hidden: true });
  // Another organization, and another person in the same one, still see it.
  expect(await t.withIdentity(person("user_alice", "org_two")).query(api.gettingStarted.status, {})).toMatchObject({ hidden: false });
  expect(await t.withIdentity(person("user_bob", "org_one")).query(api.gettingStarted.status, {})).toMatchObject({ hidden: false });
  await alice.mutation(api.gettingStarted.setHidden, { hidden: false });
  expect(await alice.query(api.gettingStarted.status, {})).toMatchObject({ hidden: false });
});

test("the dry run can be marked done by hand and undone", async () => {
  const t = setup();
  const alice = t.withIdentity(person("user_alice", "org_one"));
  await alice.mutation(api.gettingStarted.markDryRun, { done: true });
  expect(await alice.query(api.gettingStarted.status, {})).toMatchObject({ dryRunMarked: true, hidden: false });
  await alice.mutation(api.gettingStarted.markDryRun, { done: false });
  expect(await alice.query(api.gettingStarted.status, {})).toMatchObject({ dryRunMarked: false });
});

test("the guide needs a signed-in organization", async () => {
  const t = setup();
  await expect(t.query(api.gettingStarted.status, {})).rejects.toThrow("Sign in to manage events.");
  await expect(t.withIdentity({ subject: "user_alice", issuer: "https://api.workos.com/user_management/client_test" }).mutation(api.gettingStarted.setHidden, { hidden: true })).rejects.toThrow("Choose an organization");
});

test("the MCP address comes from the deployment's public site, and is absent elsewhere", async () => {
  const t = setup();
  const alice = t.withIdentity(person("user_alice", "org_one"));
  vi.stubEnv("CONVEX_SITE_URL", "https://giant-egret-456.convex.site");
  expect(await alice.query(api.gettingStarted.mcpAddress, {})).toBe("https://hack.outpostcrew.co/mcp");
  vi.stubEnv("CONVEX_SITE_URL", "https://precious-elk-564.convex.site");
  expect(await alice.query(api.gettingStarted.mcpAddress, {})).toBe("https://precious-elk-564.convex.site/mcp");
  vi.stubEnv("CONVEX_SITE_URL", "https://some-preview.convex.site");
  expect(await alice.query(api.gettingStarted.mcpAddress, {})).toBeNull();
});
