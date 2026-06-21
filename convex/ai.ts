"use node";

import { action, env } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// AI shuffle: pick + order the lineup from the pool based on the organizer's
// prompt. Runs server-side (admin-token gated via getAdmin), and only PUBLIC
// fields (name, demo title, category) are ever sent to the model.
export const aiShuffle = action({
  args: { slug: v.string(), adminToken: v.string(), prompt: v.string() },
  handler: async (ctx, args): Promise<{ count: number }> => {
    const admin = await ctx.runQuery(api.events.getAdmin, {
      slug: args.slug,
      adminToken: args.adminToken,
    });

    const people = [...admin.lineup, ...admin.pool].map((p) => ({
      id: p.id as string,
      name: p.name,
      demoTitle: p.demoTitle,
      category: p.category ?? "",
    }));
    if (people.length === 0) {
      return { count: 0 };
    }

    const target =
      admin.event.lineupTarget && admin.event.lineupTarget > 0
        ? Math.min(admin.event.lineupTarget, people.length)
        : people.length;

    const { output } = await generateText({
      model: openai(env.OPENAI_MODEL ?? "gpt-5.4"),
      output: Output.object({
        schema: z.object({
          orderedIds: z
            .array(z.string())
            .describe("Chosen submission ids, in the order they should present"),
        }),
      }),
      prompt:
        `You curate the running order for a demo night. Choose exactly ${target} presenters ` +
        `from the list and return them in presentation order as "orderedIds". Use only ids that ` +
        `appear in the list, no duplicates. Organizer instruction: "${args.prompt}".\n\n` +
        `People (JSON): ${JSON.stringify(people)}`,
    });

    const known = new Set(people.map((p) => p.id));
    const orderedIds = output.orderedIds
      .filter((id, i, arr) => known.has(id) && arr.indexOf(id) === i)
      .slice(0, target) as Id<"submissions">[];

    await ctx.runMutation(api.events.setLineupOrder, {
      slug: args.slug,
      adminToken: args.adminToken,
      orderedIds,
    });

    return { count: orderedIds.length };
  },
});
