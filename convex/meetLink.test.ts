import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
};
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const organizationId = "org_outpost";

function owner() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return { t, owner: t.withIdentity({ subject: "operator", org_id: organizationId }) };
}

test("a hackathon is created without a meet link; a demo night still needs one", async () => {
  const { t, owner: browser } = owner();
  const { eventId } = await browser.mutation(api.events.createEvent, {
    name: "Hack", slug: "hack", eventType: "hackathon", expectedOrganizationId: organizationId,
  });
  expect((await t.run((ctx) => ctx.db.get(eventId)))?.meetUrl).toBe("");
  await expect(browser.mutation(api.events.createEvent, {
    name: "Demo", slug: "demo", eventType: "demo", expectedOrganizationId: organizationId, meetUrl: "",
  })).rejects.toThrow("Google Meet link");
  await expect(browser.mutation(api.events.createEvent, {
    name: "Hack 2", slug: "hack-2", eventType: "hackathon", expectedOrganizationId: organizationId, meetUrl: "not a link",
  })).rejects.toThrow("valid meeting URL");
});

test("a hackathon becomes a demo night only with a meet link", async () => {
  const { t, owner: browser } = owner();
  const { eventId } = await browser.mutation(api.events.createEvent, {
    name: "Hack", slug: "hack", eventType: "hackathon", expectedOrganizationId: organizationId,
  });
  await expect(browser.mutation(api.events.changeEventType, { slug: "hack", eventType: "demo", confirmReset: false })).rejects.toThrow("Google Meet link");
  await browser.mutation(api.events.changeEventType, { slug: "hack", eventType: "demo", confirmReset: false, meetUrl: "https://meet.google.com/abc-defg-hij" });
  const event = await t.run((ctx) => ctx.db.get(eventId));
  expect(event).toMatchObject({ eventType: "demo", meetUrl: "https://meet.google.com/abc-defg-hij" });
  // Back to a hackathon needs nothing more; the stored link stays unused.
  await browser.mutation(api.events.changeEventType, { slug: "hack", eventType: "hackathon", confirmReset: false });
  expect((await t.run((ctx) => ctx.db.get(eventId)))?.eventType).toBe("hackathon");
});
