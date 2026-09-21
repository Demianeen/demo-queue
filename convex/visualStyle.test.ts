import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
};

const eventArgs = {
  name: "Demo night",
  slug: "demo-night",
  eventType: "demo" as const,
  meetUrl: "https://meet.example",
  adminToken: "admin",
};

async function addParticipant(
  t: ReturnType<typeof convexTest>,
  eventId: Id<"events">,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("submissions", {
      eventId,
      participantToken: "participant",
      name: "Demo maker",
      demoTitle: "A new idea",
      description: "A live demonstration",
      phone: "+440000000000",
      status: "candidate",
      createdAt: now,
      updatedAt: now,
    });
  });
}

test.each(["codex", "outpost", "astra"] as const)(
  "%s persists and reaches the stage and private participant page",
  async (visualStyle) => {
    const t = convexTest(schema, modules);
    const { eventId } = await t.mutation(api.events.createEvent, {
      ...eventArgs,
      visualStyle,
    });
    await addParticipant(t, eventId);

    expect((await t.run((ctx) => ctx.db.get(eventId)))?.visualStyle).toBe(visualStyle);
    expect((await t.query(api.events.getStage, { slug: eventArgs.slug })).event.visualStyle)
      .toBe(visualStyle);
    expect((await t.query(api.events.getParticipant, {
      slug: eventArgs.slug,
      participantToken: "participant",
    })).event.visualStyle).toBe(visualStyle);
  },
);

test("editing an Astra event preserves its selected theme", async () => {
  const t = convexTest(schema, modules);
  const { eventId } = await t.mutation(api.events.createEvent, {
    ...eventArgs,
    visualStyle: "astra",
  });

  await t.mutation(api.events.updateEvent, {
    slug: eventArgs.slug,
    adminToken: eventArgs.adminToken,
    name: "Updated demo night",
    meetUrl: "https://meet.example/updated",
  });

  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({
    name: "Updated demo night",
    meetUrl: "https://meet.example/updated",
    visualStyle: "astra",
  });
});

test("new events without a theme retain the Codex default", async () => {
  const t = convexTest(schema, modules);
  const { eventId } = await t.mutation(api.events.createEvent, eventArgs);

  expect((await t.run((ctx) => ctx.db.get(eventId)))?.visualStyle).toBe("codex");
});

test("legacy events without a stored theme render Codex on both public surfaces", async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    ...eventArgs,
    queuePublished: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
  await addParticipant(t, eventId);

  expect((await t.query(api.events.getStage, { slug: eventArgs.slug })).event.visualStyle)
    .toBe("codex");
  expect((await t.query(api.events.getParticipant, {
    slug: eventArgs.slug,
    participantToken: "participant",
  })).event.visualStyle).toBe("codex");
  expect((await t.run((ctx) => ctx.db.get(eventId)))?.visualStyle).toBeUndefined();
});
