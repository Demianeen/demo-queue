import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { bumpScoreBasis, confirmScoreBasis, deleteScoreBasis, readScoreBasis } from "./scoreBasis";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
};

test("an event from before keeps its score basis, and the next change carries it over", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", {
      name: "Old hackathon", slug: "old", eventType: "hackathon", workosOrganizationId: "org", meetUrl: "https://meet.example",
      roundOneJudges: [], queuePublished: false, createdAt: 1, updatedAt: 1, scoreBasisVersion: 7, confirmedScoreBasisVersion: 7,
    });
    const event = (await ctx.db.get(eventId))!;
    expect(await readScoreBasis(ctx, event)).toEqual({ version: 7, confirmedVersion: 7 });
    expect(await bumpScoreBasis(ctx, event, 2)).toEqual({ version: 8, confirmedVersion: undefined });
    expect(await readScoreBasis(ctx, event)).toEqual({ version: 8, confirmedVersion: undefined });
    expect(await confirmScoreBasis(ctx, event, 3)).toBe(8);
    expect(await readScoreBasis(ctx, event)).toEqual({ version: 8, confirmedVersion: 8 });
    // The event itself is never written
    expect(await ctx.db.get(eventId)).toEqual(event);
    await deleteScoreBasis(ctx, eventId);
    expect(await readScoreBasis(ctx, event)).toEqual({ version: 7, confirmedVersion: 7 });
  });
});
