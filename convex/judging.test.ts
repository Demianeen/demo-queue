import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, components } from "./_generated/api.js";
import schema from "./schema";
import tableHistorySchema from "../node_modules/@convex-dev/table-history/src/component/schema";

const tableHistoryComponentRoot =
  "../node_modules/@convex-dev/table-history/src/component";
const tableHistoryModules = {
  "./_generated/api.ts": () =>
    import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/api.ts`),
  "./_generated/server.ts": () =>
    import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/server.ts`),
  "./lib.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/lib.ts`),
};

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./judging.ts": () => import("./judging"),
};

async function createHackathon(judges = ["Alex", "Sam", "Taylor"]) {
  const t = convexTest(schema, modules);
  t.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  const event = await t.mutation(api.events.createEvent, {
    name: "Hack",
    slug: "hack",
    eventType: "hackathon",
    meetUrl: "https://meet.example",
    adminToken: "admin",
  });
  await t.mutation(api.events.saveRoundOneJudges, {
    slug: "hack",
    adminToken: "admin",
    judges,
  });
  return { t, eventId: event.eventId };
}

async function addSubmission(
  t: ReturnType<typeof convexTest>,
  eventId: Awaited<ReturnType<typeof createHackathon>>["eventId"],
  index: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("submissions", {
      eventId,
      participantToken: `participant-${index}`,
      name: `Person ${index}`,
      demoTitle: `Demo ${index}`,
      description: `Description ${index}`,
      phone: "+440000000000",
      status: "candidate",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function prepareAssignments(t: ReturnType<typeof convexTest>) {
  await t.mutation(api.judging.closeSubmissions, { slug: "hack", adminToken: "admin" });
  await t.mutation(api.judging.startAssignmentPreparation, {
    slug: "hack",
    adminToken: "admin",
  });
  for (;;) {
    const result = await t.mutation(api.judging.prepareAssignmentBatch, {
      slug: "hack",
      adminToken: "admin",
    });
    if (result.done) return;
  }
}

test("replacing judges before reviews start redistributes existing assignments", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam", "Taylor"]);
  for (let index = 0; index < 6; index += 1) {
    await addSubmission(t, eventId, index);
  }
  await prepareAssignments(t);

  await expect(
    t.mutation(api.events.saveRoundOneJudges, {
      slug: "hack",
      adminToken: "admin",
      judges: ["David", "Michael", "Nikodem"],
    }),
  ).resolves.toEqual({ judgeCount: 3, reassignedSubmissionCount: 6 });

  const submissions = await t.run(async (ctx) =>
    await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect(),
  );
  expect(
    submissions.every((submission) =>
      submission.roundOneAssignedJudges?.every((judge) =>
        ["David", "Michael", "Nikodem"].includes(judge),
      ),
    ),
  ).toBe(true);
});

test("saving a roster deactivates omitted links and reactivates re-added links", async () => {
  const { t } = await createHackathon(["Alex", "Sam"]);
  await t.mutation(api.judging.createJudgeAccess, {
    slug: "hack",
    adminToken: "admin",
    judgeName: "Alex",
    capabilityToken: "alex-secret",
  });

  await t.mutation(api.events.saveRoundOneJudges, {
    slug: "hack",
    adminToken: "admin",
    judges: ["Sam", "Taylor"],
  });
  const inactiveAccess = (
    await t.query(api.judging.listJudgeAccess, { slug: "hack", adminToken: "admin" })
  ).find((access) => access.judgeName === "Alex");
  expect(inactiveAccess).toMatchObject({
    active: false,
    token: "alex-secret",
  });

  await t.mutation(api.events.saveRoundOneJudges, {
    slug: "hack",
    adminToken: "admin",
    judges: ["Alex", "Sam", "Taylor"],
  });
  const reactivatedAccess = (
    await t.query(api.judging.listJudgeAccess, { slug: "hack", adminToken: "admin" })
  ).find((access) => access.judgeName === "Alex");
  expect(reactivatedAccess).toMatchObject({
    active: true,
    token: "alex-secret",
  });
  expect(reactivatedAccess?.deactivatedAt).toBeUndefined();
});

test("visual style is available to stage and private participant pages", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  const event = await t.mutation(api.events.createEvent, {
    name: "Outpost Hack",
    slug: "outpost-hack",
    eventType: "hackathon",
    visualStyle: "outpost",
    meetUrl: "https://meet.example",
    adminToken: "admin",
  });
  await addSubmission(t, event.eventId, 1);

  const stage = await t.query(api.events.getStage, { slug: "outpost-hack" });
  expect(stage.event.visualStyle).toBe("outpost");
  expect(stage.event.submissionsClosed).toBe(false);

  await t.mutation(api.judging.closeSubmissions, {
    slug: "outpost-hack",
    adminToken: "admin",
  });
  expect((await t.query(api.events.getStage, { slug: "outpost-hack" })).event.submissionsClosed).toBe(true);
  await expect(
    t.mutation(api.events.adminAddTestSubmissions, {
      slug: "outpost-hack",
      adminToken: "admin",
      submissions: [{
        participantToken: "late-participant",
        name: "Late person",
        demoTitle: "Late demo",
        description: "Too late",
        phone: "+440000000001",
      }],
    }),
  ).rejects.toThrow("Submissions are closed.");

  const participant = await t.query(api.events.getParticipant, {
    slug: "outpost-hack",
    participantToken: "participant-1",
  });
  expect(participant.event.visualStyle).toBe("outpost");
});

test("judge links isolate access and a single complete review produces a score", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam"]);
  const submissionId = await addSubmission(t, eventId, 1);
  await t.mutation(api.judging.createJudgeAccess, {
    slug: "hack",
    adminToken: "admin",
    judgeName: "Alex",
    capabilityToken: "alex-secret",
  });
  await t.mutation(api.judging.createJudgeAccess, {
    slug: "hack",
    adminToken: "admin",
    judgeName: "Sam",
    capabilityToken: "sam-secret",
  });
  expect(
    (await t.run(async (ctx) => await ctx.db.get(submissionId)))?.roundOneAssignedJudges,
  ).toBeUndefined();
  expect(
    (await t.query(api.judging.listJudgeAccess, { slug: "hack", adminToken: "admin" }))[0]
      .token,
  ).toBe("alex-secret");
  expect(
    await t.query(api.judging.getMyAssignments, {
      slug: "hack",
      capabilityToken: "alex-secret",
    }),
  ).toMatchObject({
    eventName: "Hack",
    judgeName: "Alex",
    judgingStatus: "setup",
    assignments: [],
  });

  await prepareAssignments(t);
  await t.mutation(api.judging.setJudgingTimer, {
    slug: "hack",
    adminToken: "admin",
    durationMs: 30 * 60 * 1000,
  });
  await t.mutation(api.judging.startJudging, { slug: "hack", adminToken: "admin" });

  expect(
    await t.mutation(api.judging.saveReview, {
      slug: "hack",
      capabilityToken: "alex-secret",
      submissionId,
      innovation: 8,
      execution: 7,
    }),
  ).toEqual({ completed: false });
  expect(
    await t.mutation(api.judging.saveReview, {
      slug: "hack",
      capabilityToken: "alex-secret",
      submissionId,
      innovation: 8,
      execution: 7,
      demoClarity: 9,
    }),
  ).toEqual({ completed: true });

  const progress = await t.query(api.judging.getAdminProgress, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(progress.scoring[0]).toMatchObject({
    assignedJudges: expect.arrayContaining(["Alex"]),
    completeReviewCount: 1,
    score: 8,
    warning: "Only one complete review",
  });
  expect(progress.reviews[0]).toMatchObject({
    judgeName: "Alex",
    innovation: 8,
    execution: 7,
    demoClarity: 9,
    completed: true,
  });
  expect(
    await t.query(api.judging.getMyAssignments, {
      slug: "hack",
      capabilityToken: "alex-secret",
    }),
  ).toMatchObject({ judgingStatus: "open", assignments: [{ id: submissionId }] });

  expect(
    await t.mutation(api.judging.closeSubmissions, { slug: "hack", adminToken: "admin" }),
  ).toEqual({ judgingStatus: "open" });
});

test("redistribution moves only an unavailable judge's unfinished slot", async () => {
  const { t, eventId } = await createHackathon();
  const submissionId = await addSubmission(t, eventId, 1);
  for (const [judgeName, capabilityToken] of [
    ["Alex", "alex-secret"],
    ["Sam", "sam-secret"],
    ["Taylor", "taylor-secret"],
  ] as const) {
    await t.mutation(api.judging.createJudgeAccess, {
      slug: "hack",
      adminToken: "admin",
      judgeName,
      capabilityToken,
    });
  }
  await prepareAssignments(t);
  await t.mutation(api.judging.startJudging, { slug: "hack", adminToken: "admin" });
  const assignment = (await t.run(async (ctx) => await ctx.db.get(submissionId)))!
    .roundOneAssignedJudges!;
  const unavailable = assignment[0];
  const kept = assignment[1];
  const access = await t.query(api.judging.listJudgeAccess, {
    slug: "hack",
    adminToken: "admin",
  });
  const unavailableAccess = access.find((item) => item.judgeName === unavailable)!;
  const keptAccess = access.find((item) => item.judgeName === kept)!;

  await t.mutation(api.judging.saveReview, {
    slug: "hack",
    capabilityToken: keptAccess.token,
    submissionId,
    innovation: 9,
    execution: 8,
    demoClarity: 7,
  });
  await t.mutation(api.judging.saveReview, {
    slug: "hack",
    capabilityToken: unavailableAccess.token,
    submissionId,
    innovation: 4,
  });

  const preview = await t.query(api.judging.previewRedistribution, {
    slug: "hack",
    adminToken: "admin",
    unavailableJudgeKey: unavailableAccess.judgeKey,
  });
  expect(preview).toHaveLength(1);
  expect(preview[0].judges).toContain(kept);
  expect(preview[0].judges).not.toContain(unavailable);
  expect(preview[0].preservedCompletedJudge).toBe(keptAccess.judgeKey);

  await t.mutation(api.judging.applyRedistribution, {
    slug: "hack",
    adminToken: "admin",
    unavailableJudgeKey: unavailableAccess.judgeKey,
    assignments: preview.map((item) => ({
      submissionId: item.submissionId,
      judges: item.judges,
    })),
  });

  const progress = await t.query(api.judging.getAdminProgress, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(progress.scoring[0]).toMatchObject({ completeReviewCount: 1, score: 8 });
  await expect(
    t.mutation(api.judging.saveReview, {
      slug: "hack",
      capabilityToken: unavailableAccess.token,
      submissionId,
      innovation: 10,
      execution: 10,
      demoClarity: 10,
    }),
  ).rejects.toThrow("Unauthorized");
});

test("assignment preparation covers 500 submissions without exposing a partial round", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam", "Taylor", "Jo"]);
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let index = 0; index < 500; index += 1) {
      await ctx.db.insert("submissions", {
        eventId,
        participantToken: `participant-${index}`,
        name: `Person ${index}`,
        demoTitle: `Demo ${index}`,
        description: `Description ${index}`,
        phone: "+440000000000",
        status: "candidate",
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  await prepareAssignments(t);
  const submissions = await t.run(async (ctx) =>
    await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(submissions).toHaveLength(500);
  expect(submissions.every((submission) => submission.roundOneAssignedJudges?.length === 2)).toBe(
    true,
  );
  const progress = await t.query(api.judging.getAdminProgress, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(progress.eventStatus).toBe("ready");
});

test("normalization decisions, finalist amendments, and placements stay independent", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam"]);
  const firstId = await addSubmission(t, eventId, 1);
  const secondId = await addSubmission(t, eventId, 2);
  const unreviewedId = await addSubmission(t, eventId, 3);
  for (const [judgeName, capabilityToken] of [
    ["Alex", "alex-secret"],
    ["Sam", "sam-secret"],
  ] as const) {
    await t.mutation(api.judging.createJudgeAccess, {
      slug: "hack",
      adminToken: "admin",
      judgeName,
      capabilityToken,
    });
  }
  await prepareAssignments(t);
  await t.mutation(api.judging.startJudging, { slug: "hack", adminToken: "admin" });

  await t.mutation(api.judging.saveReview, {
    slug: "hack",
    capabilityToken: "alex-secret",
    submissionId: firstId,
    innovation: 9,
  });
  expect(
    (await t.run(async (ctx) => await ctx.db.get(eventId)))?.scoreBasisVersion,
  ).toBeUndefined();

  for (const review of [
    { capabilityToken: "alex-secret", submissionId: firstId, score: 9 },
    { capabilityToken: "sam-secret", submissionId: firstId, score: 1 },
    { capabilityToken: "alex-secret", submissionId: secondId, score: 3 },
    { capabilityToken: "sam-secret", submissionId: secondId, score: 9 },
  ]) {
    await t.mutation(api.judging.saveReview, {
      slug: "hack",
      capabilityToken: review.capabilityToken,
      submissionId: review.submissionId,
      innovation: review.score,
      execution: review.score,
      demoClarity: review.score,
    });
  }
  await t.mutation(api.judging.closeJudging, { slug: "hack", adminToken: "admin" });

  const initialOverview = await t.query(api.judging.getNormalizationOverview, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(initialOverview.scoreBasisReady).toBe(true);
  expect(initialOverview.judges).toHaveLength(2);
  expect(initialOverview.judges.every((judge) => judge.lowData)).toBe(true);
  expect(initialOverview.judges[0].reviews[0]).toMatchObject({
    raw: { innovation: 9, execution: 9, demoClarity: 9 },
    rawAverage: 9,
  });

  const defaultRanked = await t.query(api.judging.getFinalistDecision, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(defaultRanked.scoreBasisReady).toBe(true);
  expect(defaultRanked.submissions[0]).toMatchObject({
    submissionId: secondId,
    adjustedReviewCount: 2,
  });

  expect(
    await t.mutation(api.judging.saveNormalizationDecision, {
      slug: "hack",
      adminToken: "admin",
      judgeKey: "alex",
      decision: "apply",
    }),
  ).toEqual({ scoreBasisReady: true });
  expect(
    await t.mutation(api.judging.saveNormalizationDecision, {
      slug: "hack",
      adminToken: "admin",
      judgeKey: "sam",
      decision: "raw",
    }),
  ).toEqual({ scoreBasisReady: true });

  const ranked = await t.query(api.judging.getFinalistDecision, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(ranked.scoreBasisReady).toBe(true);
  expect(ranked.submissions.map((submission) => submission.submissionId)).toEqual([
    secondId,
    firstId,
    unreviewedId,
  ]);
  expect(ranked.submissions[0]).toMatchObject({
    rawScore: 6,
    score: 5.75,
    completeReviewCount: 2,
    adjustedReviewCount: 1,
  });
  expect(ranked.submissions[2]).toMatchObject({
    score: null,
    warning: "No complete reviews",
  });

  await t.mutation(api.judging.reopenJudging, { slug: "hack", adminToken: "admin" });
  await t.mutation(api.judging.saveReview, {
    slug: "hack",
    capabilityToken: "alex-secret",
    submissionId: firstId,
    innovation: 8,
    execution: 8,
    demoClarity: 8,
  });
  await t.mutation(api.judging.closeJudging, { slug: "hack", adminToken: "admin" });
  const staleOverview = await t.query(api.judging.getNormalizationOverview, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(staleOverview.scoreBasisReady).toBe(true);
  expect(staleOverview.judges.find((judge) => judge.judgeKey === "alex")?.decision).toEqual({
    decision: "apply",
    stale: true,
  });
  expect(staleOverview.judges.find((judge) => judge.judgeKey === "sam")?.decision).toEqual({
    decision: "raw",
    stale: false,
  });
  expect(
    await t.mutation(api.judging.saveNormalizationDecision, {
      slug: "hack",
      adminToken: "admin",
      judgeKey: "alex",
      decision: "apply",
    }),
  ).toEqual({ scoreBasisReady: true });

  await t.mutation(api.judging.saveFinalistDraft, {
    slug: "hack",
    adminToken: "admin",
    finalistIds: [secondId, firstId],
  });
  await t.mutation(api.judging.submitFinalists, {
    slug: "hack",
    adminToken: "admin",
    finalistIds: [secondId, firstId],
  });
  expect(
    await t.query(api.events.getParticipant, {
      slug: "hack",
      participantToken: "participant-2",
    }),
  ).toMatchObject({ submission: { finalist: true, status: "candidate" } });
  expect(
    await t.query(api.events.getParticipant, {
      slug: "hack",
      participantToken: "participant-3",
    }),
  ).toMatchObject({ submission: { finalist: false, status: "candidate" } });

  await t.mutation(api.judging.savePlacementDraft, {
    slug: "hack",
    adminToken: "admin",
    placementIds: [],
  });
  await t.mutation(api.judging.submitPlacements, {
    slug: "hack",
    adminToken: "admin",
    placementIds: [secondId, firstId],
  });
  await t.mutation(api.judging.submitFinalists, {
    slug: "hack",
    adminToken: "admin",
    finalistIds: [firstId],
  });

  const amended = await t.query(api.judging.getFinalistDecision, {
    slug: "hack",
    adminToken: "admin",
  });
  expect(amended).toMatchObject({
    finalistIds: [firstId],
    finalistStatus: "submitted",
    finalistVersion: 2,
    placementIds: [firstId],
    placementStatus: "needs_review",
    placementVersion: 1,
  });
  const secondSubmission = await t.run(async (ctx) => await ctx.db.get(secondId));
  expect(secondSubmission).toMatchObject({ status: "candidate", finalist: false });

  const history = await t.query(
    components.judgingDecisionHistory.lib.listHistory,
    {
      maxTs: Date.now() + 10_000,
      paginationOpts: { numItems: 10, cursor: null },
    },
  );
  expect(history.page).toHaveLength(3);
});
