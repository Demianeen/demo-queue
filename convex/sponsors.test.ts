import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./sponsors.ts": () => import("./sponsors"),
  "./tracks.ts": () => import("./tracks"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const organizationId = "org_outpost";
const identity = (org: string) => ({ subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: org });
const hackathon = { expectedOrganizationId: organizationId, name: "Hack day", slug: "hack-day", eventType: "hackathon" as const };

async function fixture(sponsors: { name: string; usage?: string }[] = [{ name: "Daytona", usage: "Runs code in Daytona sandboxes (daytona SDK)" }]) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity(identity(organizationId));
  await owner.mutation(api.events.createEvent, { ...hackathon, sponsors });
  const read = async () => (await owner.query(api.events.getAdmin, { slug: hackathon.slug })).sponsors;
  return { t, owner, read };
}

test("a hackathon is created with its sponsors, blank rows dropped", async () => {
  const { read } = await fixture([{ name: "Daytona", usage: "  Runs code in   Daytona sandboxes " }, { name: "  ", usage: "" }, { name: "OpenAI" }]);
  expect((await read()).map((sponsor) => [sponsor.name, sponsor.usage])).toEqual([["Daytona", "Runs code in Daytona sandboxes"], ["OpenAI", undefined]]);
});

test("a demo night takes no sponsors", async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity(identity(organizationId));
  await expect(owner.mutation(api.events.createEvent, { ...hackathon, slug: "demo", eventType: "demo", meetUrl: "https://meet.google.com/abc-defg-hij", sponsors: [{ name: "Daytona" }] }))
    .rejects.toThrow("Sponsors are for hackathons.");
});

test("sponsors are added, edited and removed in Settings, with unique names", async () => {
  const { owner, read } = await fixture();
  const { sponsorId } = await owner.mutation(api.sponsors.addSponsor, { slug: hackathon.slug, name: "OpenAI", usage: "Calls the OpenAI API" });
  await expect(owner.mutation(api.sponsors.addSponsor, { slug: hackathon.slug, name: "openai" })).rejects.toThrow('There is already a sponsor called "openai".');
  await owner.mutation(api.sponsors.updateSponsor, { slug: hackathon.slug, sponsorId, name: "OpenAI", usage: undefined });
  expect((await read()).map((sponsor) => [sponsor.name, sponsor.usage])).toEqual([["Daytona", "Runs code in Daytona sandboxes (daytona SDK)"], ["OpenAI", undefined]]);
  await owner.mutation(api.sponsors.removeSponsor, { slug: hackathon.slug, sponsorId });
  expect((await read()).map((sponsor) => sponsor.name)).toEqual(["Daytona"]);
});

test("another organization cannot change a hackathon's sponsors", async () => {
  const { t, read } = await fixture();
  const [daytona] = await read();
  const stranger = t.withIdentity(identity("org_other"));
  await expect(stranger.mutation(api.sponsors.removeSponsor, { slug: hackathon.slug, sponsorId: daytona.id })).rejects.toThrow();
  expect(await read()).toHaveLength(1);
});
