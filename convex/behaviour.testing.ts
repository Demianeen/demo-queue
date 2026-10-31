// Shared setup for the new-behaviour tests. Not a Convex module: it is only imported by *.test.ts files.
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import tableHistorySchema from "../node_modules/@convex-dev/table-history/src/component/schema";

const tableHistoryComponentRoot = "../node_modules/@convex-dev/table-history/src/component";
const tableHistoryModules = {
  "./_generated/api.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/api.ts`),
  "./_generated/server.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/server.ts`),
  "./lib.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/lib.ts`),
};

export const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./tracks.ts": () => import("./tracks"),
  "./sponsors.ts": () => import("./sponsors"),
  "./aiSummaries.ts": () => import("./aiSummaries"),
  "./aiSummaryAction.ts": () => import("./aiSummaryAction"),
  "./aiUsage.ts": () => import("./aiUsage"),
  "./ai.ts": () => import("./ai"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
  "./phases.ts": () => import("./phases"),
  "./changes.ts": () => import("./changes"),
  "./changeLog.ts": () => import("./changeLog"),
  "./mcpAdmin.ts": () => import("./mcpAdmin"),
  "./luma.ts": () => import("./luma"),
  "./practice.ts": () => import("./practice"),
  "./members.ts": () => import("./members"),
};

export const ORG = "org_live";
export const ACTOR_SUBJECT = "user_01DEMIAN";

export function setupTest() {
  const root = convexTest(schema, modules);
  root.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  rateLimiterTest.register(root);
  const t = root.withIdentity({ subject: ACTOR_SUBJECT, org_id: ORG, tokenIdentifier: `https://api.workos.com/user_management/client_test|${ACTOR_SUBJECT}` });
  return { root, t };
}

export type TestClient = ReturnType<typeof setupTest>["t"];

export async function createEvent(t: TestClient, input: { slug?: string; eventType?: "demo" | "hackathon"; judges?: string[]; extra?: Record<string, unknown> } = {}) {
  const slug = input.slug ?? "hack";
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    name: "DevDay Exchange", slug, eventType: input.eventType ?? "hackathon", workosOrganizationId: ORG,
    meetUrl: "https://meet.example", queuePublished: false, createdAt: 1, updatedAt: 1,
    ...(input.extra ?? {}),
  }));
  if (input.judges) await t.mutation(api.events.saveRoundOneJudges, { slug, judges: input.judges });
  return { eventId, slug };
}

export async function addProject(t: TestClient, eventId: Id<"events">, index: number, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) => ctx.db.insert("submissions", {
    eventId,
    participantToken: `participant-${index}`,
    name: `Person ${index}`,
    email: `person${index}@example.com`,
    normalizedEmail: `person${index}@example.com`,
    demoTitle: `Project ${index}`,
    description: `Description ${index}`,
    phone: "+440000000000",
    status: "candidate",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  }));
}

/** Closes submissions, assigns two judges to each project, and opens judging. */
export async function openJudging(t: TestClient, slug = "hack") {
  await t.mutation(api.judging.closeSubmissions, { slug });
  await t.mutation(api.judging.startAssignmentPreparation, { slug });
  while (!(await t.mutation(api.judging.prepareAssignmentBatch, { slug })).done);
  await t.mutation(api.judging.startJudging, { slug });
}

export async function judgeLink(t: TestClient, judgeName: string, slug = "hack") {
  const capabilityToken = `${judgeName.toLowerCase().replace(/\s+/g, "-")}-secret-token`;
  await t.mutation(api.judging.createJudgeAccess, { slug, judgeName, capabilityToken });
  return capabilityToken;
}

export async function score(t: TestClient, capabilityToken: string, submissionId: Id<"submissions">, value: number, slug = "hack") {
  return t.mutation(api.judging.saveReview, { slug, capabilityToken, submissionId, innovation: value, execution: value, demoClarity: value });
}
