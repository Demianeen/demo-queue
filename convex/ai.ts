"use node";

import { action, env, internalAction, type ActionCtx } from "./_generated/server";
import type { Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { aiShuffleArgs } from "./adminActionArgs";
import {
  organizationPrincipalValidator,
  requireOrganization,
  type OrganizationPrincipal,
} from "./organizationAuth";

// AI shuffle: pick + order the lineup from the pool based on the organizer's
// prompt. Runs server-side (organization gated via getAdmin), and only PUBLIC
// fields (name, demo title, tracks) are ever sent to the model.
export async function aiShuffleForOrganization(
  ctx: ActionCtx,
  args: Infer<typeof aiShuffleArgs>,
  principal: OrganizationPrincipal,
): Promise<{ count: number }> {
  const admin = await ctx.runQuery(internal.mcpAdmin.getAdminForAction, {
    principal,
    input: { slug: args.slug },
  });

  const submissions = [...admin.lineup, ...admin.pool];
  const knownIds = new Map<string, Id<"submissions">>(
    submissions.map((submission) => [submission.id, submission.id]),
  );
  const people = submissions.map((p) => ({
    id: p.id,
    name: p.name,
    demoTitle: p.demoTitle,
    tracks: p.tracks.join(", "),
  }));
  if (people.length === 0) {
    return { count: 0 };
  }

  const target =
    admin.event.lineupTarget && admin.event.lineupTarget > 0
      ? Math.min(admin.event.lineupTarget, people.length)
      : people.length;
  const openaiApiKey = env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured for this Convex deployment. Set it with `pnpm exec convex env set OPENAI_API_KEY <key>` before using AI shuffle.",
    );
  }
  const openai = createOpenAI({ apiKey: openaiApiKey });

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

  const orderedIds = output.orderedIds
    .flatMap((id, i, arr) => {
      const knownId = knownIds.get(id);
      return knownId !== undefined && arr.indexOf(id) === i ? [knownId] : [];
    })
    .slice(0, target);

  await ctx.runMutation(internal.mcpAdmin.setLineupOrder, {
    principal,
    input: { slug: args.slug, orderedIds },
  });

  return { count: orderedIds.length };
}

export const aiShuffle = action({
  args: aiShuffleArgs,
  handler: async (ctx, args): Promise<{ count: number }> =>
    aiShuffleForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const aiShuffleMcp = internalAction({
  args: { principal: organizationPrincipalValidator, input: aiShuffleArgs },
  handler: async (ctx, args): Promise<{ count: number }> =>
    aiShuffleForOrganization(ctx, args.input, args.principal),
});
