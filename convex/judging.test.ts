import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, components } from "./_generated/api.js";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
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

test("demo owners cannot change judging state or create judge access", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "operator", org_id: "org_judging" });
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "Demo night", slug: "demo-night", eventType: "demo", workosOrganizationId: "org_judging",
    meetUrl: "https://meet.example", roundOneJudges: ["Alex"], queuePublished: false, createdAt: 1, updatedAt: 1,
  }));
  const before = await t.run((ctx) => ctx.db.get(eventId));
  await expect(t.mutation(api.judging.closeSubmissions, { slug: "demo-night" })).rejects.toThrow("Judging is only available for hackathon events.");
  await expect(t.mutation(api.judging.createJudgeAccess, { slug: "demo-night", judgeName: "Alex", capabilityToken: "demo-judge" })).rejects.toThrow("Judging is only available for hackathon events.");
  expect(await t.run((ctx) => ctx.db.get(eventId))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("judgeAccess").collect())).toEqual([]);
});

test("hackathon owners can close submissions and create judge access", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam"]);
  await t.mutation(api.judging.closeSubmissions, { slug: "hack" });
  await t.mutation(api.judging.createJudgeAccess, { slug: "hack", judgeName: "Alex", capabilityToken: "hack-judge" });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ submissionsClosedAt: expect.any(Number) });
  expect(await t.query(api.judging.listJudgeAccess, { slug: "hack" })).toMatchObject([{ judgeName: "Alex", token: "hack-judge", active: true }]);
});


async function seedLegacyEvent(t: Pick<ReturnType<typeof convexTest>, "run" | "query" | "mutation">, input: {
  name: string; slug: string; eventType: "hackathon"; meetUrl: string;
  visualStyle?: "outpost";
}) {
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    ...input, workosOrganizationId: "org_judging", queuePublished: false, createdAt: Date.now(), updatedAt: Date.now(),
  }));
  return { eventId };
}

async function createHackathon(judges = ["Alex", "Sam", "Taylor"]) {
  const root = convexTest(schema, modules);
  root.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  const t = root.withIdentity({ subject: "operator", org_id: "org_judging" });
  const event = await seedLegacyEvent(t, {
    name: "Hack",
    slug: "hack",
    eventType: "hackathon",
    meetUrl: "https://meet.example",
    });
  await t.mutation(api.events.saveRoundOneJudges, {
    slug: "hack",
    judges,
  });
  return { t, eventId: event.eventId };
}

async function addSubmission(
  t: Pick<ReturnType<typeof convexTest>, "run" | "query" | "mutation">,
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

async function prepareAssignments(t: Pick<ReturnType<typeof convexTest>, "run" | "query" | "mutation">) {
  await t.mutation(api.judging.closeSubmissions, { slug: "hack", });
  await t.mutation(api.judging.startAssignmentPreparation, {
    slug: "hack",
    });
  for (;;) {
    const result = await t.mutation(api.judging.prepareAssignmentBatch, {
      slug: "hack",
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
    judgeName: "Alex",
    capabilityToken: "alex-secret",
  });

  await t.mutation(api.events.saveRoundOneJudges, {
    slug: "hack",
    judges: ["Sam", "Taylor"],
  });
  const inactiveAccess = (
    await t.query(api.judging.listJudgeAccess, { slug: "hack", })
  ).find((access) => access.judgeName === "Alex");
  expect(inactiveAccess).toMatchObject({
    active: false,
    token: "alex-secret",
  });

  await t.mutation(api.events.saveRoundOneJudges, {
    slug: "hack",
    judges: ["Alex", "Sam", "Taylor"],
  });
  const reactivatedAccess = (
    await t.query(api.judging.listJudgeAccess, { slug: "hack", })
  ).find((access) => access.judgeName === "Alex");
  expect(reactivatedAccess).toMatchObject({
    active: true,
    token: "alex-secret",
  });
  expect(reactivatedAccess?.deactivatedAt).toBeUndefined();
});

test("visual style is available to stage and private participant pages", async () => {
  const root = convexTest(schema, modules);
  root.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  const t = root.withIdentity({ subject: "operator", org_id: "org_judging" });
  const event = await seedLegacyEvent(t, {
    name: "Outpost Hack",
    slug: "outpost-hack",
    eventType: "hackathon",
    visualStyle: "outpost",
    meetUrl: "https://meet.example",
    });
  await addSubmission(t, event.eventId, 1);

  const stage = await t.query(api.events.getStage, { slug: "outpost-hack" });
  expect(stage.event.visualStyle).toBe("outpost");
  expect(stage.event.submissionsClosed).toBe(false);

  await t.mutation(api.judging.closeSubmissions, {
    slug: "outpost-hack",
    });
  expect((await t.query(api.events.getStage, { slug: "outpost-hack" })).event.submissionsClosed).toBe(true);
  await expect(
    t.mutation(api.events.adminAddTestSubmissions, {
      slug: "outpost-hack",
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
    judgeName: "Alex",
    capabilityToken: "alex-secret",
  });
  await t.mutation(api.judging.createJudgeAccess, {
    slug: "hack",
    judgeName: "Sam",
    capabilityToken: "sam-secret",
  });
  expect(
    (await t.run(async (ctx) => await ctx.db.get(submissionId)))?.roundOneAssignedJudges,
  ).toBeUndefined();
  expect(
    (await t.query(api.judging.listJudgeAccess, { slug: "hack", }))[0]
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
    durationMs: 30 * 60 * 1000,
  });
  await t.mutation(api.judging.startJudging, { slug: "hack", });

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
    await t.mutation(api.judging.closeSubmissions, { slug: "hack", }),
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
      judgeName,
      capabilityToken,
    });
  }
  await prepareAssignments(t);
  await t.mutation(api.judging.startJudging, { slug: "hack", });
  const assignment = (await t.run(async (ctx) => await ctx.db.get(submissionId)))!
    .roundOneAssignedJudges!;
  const unavailable = assignment[0];
  const kept = assignment[1];
  const access = await t.query(api.judging.listJudgeAccess, {
    slug: "hack",
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
    unavailableJudgeKey: unavailableAccess.judgeKey,
  });
  expect(preview).toHaveLength(1);
  expect(preview[0].judges).toContain(kept);
  expect(preview[0].judges).not.toContain(unavailable);
  expect(preview[0].preservedCompletedJudge).toBe(keptAccess.judgeKey);

  await t.mutation(api.judging.applyRedistribution, {
    slug: "hack",
    unavailableJudgeKey: unavailableAccess.judgeKey,
    assignments: preview.map((item) => ({
      submissionId: item.submissionId,
      judges: item.judges,
    })),
  });

  const progress = await t.query(api.judging.getAdminProgress, {
    slug: "hack",
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
      judgeName,
      capabilityToken,
    });
  }
  await prepareAssignments(t);
  await t.mutation(api.judging.startJudging, { slug: "hack", });

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
  await t.mutation(api.judging.closeJudging, { slug: "hack", });

  const initialOverview = await t.query(api.judging.getNormalizationOverview, {
    slug: "hack",
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
    });
  expect(defaultRanked.scoreBasisReady).toBe(true);
  expect(defaultRanked.submissions[0]).toMatchObject({
    submissionId: secondId,
    adjustedReviewCount: 2,
  });

  expect(
    await t.mutation(api.judging.saveNormalizationDecision, {
      slug: "hack",
      judgeKey: "alex",
      decision: "apply",
    }),
  ).toEqual({ scoreBasisReady: true });
  expect(
    await t.mutation(api.judging.saveNormalizationDecision, {
      slug: "hack",
      judgeKey: "sam",
      decision: "raw",
    }),
  ).toEqual({ scoreBasisReady: true });

  const ranked = await t.query(api.judging.getFinalistDecision, {
    slug: "hack",
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

  await t.mutation(api.judging.reopenJudging, { slug: "hack", });
  await t.mutation(api.judging.saveReview, {
    slug: "hack",
    capabilityToken: "alex-secret",
    submissionId: firstId,
    innovation: 8,
    execution: 8,
    demoClarity: 8,
  });
  await t.mutation(api.judging.closeJudging, { slug: "hack", });
  const staleOverview = await t.query(api.judging.getNormalizationOverview, {
    slug: "hack",
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
      judgeKey: "alex",
      decision: "apply",
    }),
  ).toEqual({ scoreBasisReady: true });

  await t.mutation(api.judging.saveFinalistDraft, {
    slug: "hack",
    finalistIds: [secondId, firstId],
  });
  await t.mutation(api.judging.submitFinalists, {
    slug: "hack",
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
    placementIds: [],
  });
  await t.mutation(api.judging.submitPlacements, {
    slug: "hack",
    placementIds: [secondId, firstId],
  });
  await t.mutation(api.judging.submitFinalists, {
    slug: "hack",
    finalistIds: [firstId],
  });

  const amended = await t.query(api.judging.getFinalistDecision, {
    slug: "hack",
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

test("judges can read every submission in judging but score only their own", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam", "Taylor"]);
  const ids: Id<"submissions">[] = [];
  for (let index = 0; index < 6; index += 1) ids.push(await addSubmission(t, eventId, index));
  await t.run(async (ctx) => {
    await ctx.db.patch(ids[0], { teamName: "Night Owls" });
    for (const name of ["Ana", "Luca"]) {
      await ctx.db.insert("teamMembers", { eventId, submissionId: ids[0], name, email: `${name}@example.com`, whatsappPhone: "+440000000001", createdAt: 1 });
    }
  });
  const withdrawnId = await addSubmission(t, eventId, 9);
  await t.run((ctx) => ctx.db.patch(withdrawnId, { status: "withdrawn" }));
  await t.mutation(api.judging.createJudgeAccess, { slug: "hack", judgeName: "Alex", capabilityToken: "alex-secret" });
  await t.mutation(api.judging.createJudgeAccess, { slug: "hack", judgeName: "Sam", capabilityToken: "sam-secret" });

  // Nothing is visible before judging opens.
  expect(await t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "alex-secret" })).toEqual([]);
  await prepareAssignments(t);
  expect(await t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "alex-secret" })).toEqual([]);
  await t.mutation(api.judging.startJudging, { slug: "hack" });

  const mine = await t.query(api.judging.getMyAssignments, { slug: "hack", capabilityToken: "alex-secret" });
  const others = await t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "alex-secret" });
  const mineIds = mine.assignments.map((item) => item.id);
  const otherIds = others.map((item) => item.id);
  expect(mineIds.length).toBeGreaterThan(0);
  expect(otherIds.length).toBeGreaterThan(0);
  // Together they cover every submission in judging exactly once, and never a withdrawn one.
  expect([...mineIds, ...otherIds].sort()).toEqual([...ids].sort());
  expect(otherIds).not.toContain(withdrawnId);
  const submissions = await t.run((ctx) => ctx.db.query("submissions").collect());
  for (const id of otherIds) {
    expect(submissions.find((s) => s._id === id)?.roundOneAssignedJudges).not.toContain("Alex");
  }

  // Team details without anyone's contact details.
  const team = [...mine.assignments, ...others].find((item) => item.id === ids[0])!;
  expect(team).toMatchObject({ teamName: "Night Owls", memberCount: 3, demoTitle: "Demo 0", name: "Person 0" });
  for (const item of others) {
    expect(Object.keys(item).sort()).toEqual(["demoTitle", "description", "githubUrl", "id", "memberCount", "name", "teamName", "tracks", "videoUrl"]);
  }
  expect(JSON.stringify(others)).not.toMatch(/\+44|@example\.com|participant-/);

  // Scoring someone else's submission is refused and writes nothing.
  await expect(t.mutation(api.judging.saveReview, {
    slug: "hack", capabilityToken: "alex-secret", submissionId: otherIds[0], innovation: 8, execution: 8, demoClarity: 8,
  })).rejects.toThrow("Submission is not assigned to this judge.");
  expect(await t.run((ctx) => ctx.db.query("reviews").collect())).toEqual([]);
  await expect(t.mutation(api.judging.saveReview, {
    slug: "hack", capabilityToken: "alex-secret", submissionId: mineIds[0], innovation: 8, execution: 8, demoClarity: 8,
  })).resolves.toEqual({ completed: true });

  // Each judge's "others" are their own complement.
  const samMine = (await t.query(api.judging.getMyAssignments, { slug: "hack", capabilityToken: "sam-secret" })).assignments.map((item) => item.id);
  const samOthers = (await t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "sam-secret" })).map((item) => item.id);
  expect([...samMine, ...samOthers].sort()).toEqual([...ids].sort());

  // Reading stays available once judging closes.
  await t.mutation(api.judging.closeJudging, { slug: "hack" });
  expect(await t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "alex-secret" })).toHaveLength(otherIds.length);
});

test("other submissions need an active judge link for that event", async () => {
  const { t, eventId } = await createHackathon(["Alex", "Sam"]);
  await addSubmission(t, eventId, 1);
  await t.mutation(api.judging.createJudgeAccess, { slug: "hack", judgeName: "Alex", capabilityToken: "alex-secret" });
  await prepareAssignments(t);
  await t.mutation(api.judging.startJudging, { slug: "hack" });
  await t.run((ctx) => ctx.db.insert("events", {
    name: "Other", slug: "other-hack", eventType: "hackathon", workosOrganizationId: "org_other",
    meetUrl: "https://meet.example", queuePublished: false, judgingStatus: "open", createdAt: 1, updatedAt: 1,
  }));

  await expect(t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "wrong" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.judging.getOtherSubmissions, { slug: "other-hack", capabilityToken: "alex-secret" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.judging.getOtherSubmissions, { slug: "missing", capabilityToken: "alex-secret" })).rejects.toThrow("Event not found.");
  await t.mutation(api.judging.deactivateJudgeAccess, { slug: "hack", judgeKey: "alex", active: false });
  await expect(t.query(api.judging.getOtherSubmissions, { slug: "hack", capabilityToken: "alex-secret" })).rejects.toThrow("Unauthorized");
});
