import { ConvexError } from "convex/values";
import { env, internalMutation } from "./_generated/server";
import { createPracticeEventWithOwner, scoreAsTestJudgesForOrganization } from "./practice";
import {
  closeSubmissionsForOrganization,
  pauseJudgingTimerForOrganization,
  prepareAssignmentBatchForOrganization,
  startAssignmentPreparationForOrganization,
  startJudgingForOrganization,
} from "./judging";

/**
 * Test data for a Vercel preview's own Convex deployment. `convex deploy`
 * runs this once, when it creates the preview (`--preview-run` in
 * scripts/vercel-build.mjs). It makes two practice hackathons, through the
 * same code as Practice > New practice event, in the organisation named by
 * PREVIEW_SEED_ORGANIZATION_ID: one taking submissions, one in judging.
 * Previews sign in through the development WorkOS client, so that is a
 * development organisation, such as Test.
 */

/**
 * Resend's test inbox: it accepts mail without delivering it. Test people are
 * plus-addresses of it (delivered+dq-test-3@resend.dev), so a preview never
 * emails a real person, even with Resend configured.
 */
export const PREVIEW_SEED_OWNER_EMAIL = "delivered@resend.dev";
const SEED_ACTOR = "preview-seed";

export const PREVIEW_SEED_EVENTS: { name: string; testSubmissions: number; testJudges: number; scoredInJudging?: number }[] = [
  { name: "Preview hackathon, submissions open", testSubmissions: 8, testJudges: 3 },
  // About half of the 24 reviews are scored, so judging progress shows both kinds.
  { name: "Preview hackathon, judging", testSubmissions: 12, testJudges: 4, scoredInJudging: 10 },
];

/** Safe to run again: an event whose name is already there is left alone. */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organizationId = env.PREVIEW_SEED_ORGANIZATION_ID?.trim();
    if (!organizationId || !/^org_[A-Za-z0-9]+$/.test(organizationId)) {
      throw new ConvexError("Set PREVIEW_SEED_ORGANIZATION_ID to a WorkOS organisation id (org_...) in the project's default environment variables for preview deployments.");
    }
    const principal = { organizationId, actor: SEED_ACTOR };
    const practiceNames = new Set((await ctx.db.query("events")
      .withIndex("by_workosOrganizationId_and_practice", (q) => q.eq("workosOrganizationId", organizationId).eq("practice", true))
      .take(100)).map((event) => event.name));
    const created: string[] = [];
    const existing: string[] = [];
    for (const seedEvent of PREVIEW_SEED_EVENTS) {
      if (practiceNames.has(seedEvent.name)) {
        existing.push(seedEvent.name);
        continue;
      }
      const { slug } = await createPracticeEventWithOwner(ctx, principal, PREVIEW_SEED_OWNER_EMAIL, {
        expectedOrganizationId: organizationId,
        start: { kind: "blank", eventType: "hackathon" },
        name: seedEvent.name,
        testSubmissions: seedEvent.testSubmissions,
        testJudges: seedEvent.testJudges,
      });
      if (seedEvent.scoredInJudging !== undefined) {
        // The same steps as the Judging page: close, assign two judges per project, start, then score some.
        await closeSubmissionsForOrganization(ctx, { slug }, principal);
        await startAssignmentPreparationForOrganization(ctx, { slug }, principal);
        while (!(await prepareAssignmentBatchForOrganization(ctx, { slug }, principal)).done);
        await startJudgingForOrganization(ctx, { slug }, principal);
        await scoreAsTestJudgesForOrganization(ctx, { slug, limit: seedEvent.scoredInJudging }, principal);
        // Paused, so the preview stays in judging however long it lives.
        await pauseJudgingTimerForOrganization(ctx, { slug }, principal);
      }
      created.push(seedEvent.name);
    }
    return { created, existing };
  },
});
