/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminActionArgs from "../adminActionArgs.js";
import type * as ai from "../ai.js";
import type * as aiSummaries from "../aiSummaries.js";
import type * as aiSummaryAction from "../aiSummaryAction.js";
import type * as aiUsage from "../aiUsage.js";
import type * as analytics from "../analytics.js";
import type * as changeLog from "../changeLog.js";
import type * as changeWrap from "../changeWrap.js";
import type * as changes from "../changes.js";
import type * as crons from "../crons.js";
import type * as emails from "../emails.js";
import type * as eventOwnership from "../eventOwnership.js";
import type * as eventSlugs from "../eventSlugs.js";
import type * as eventTheme from "../eventTheme.js";
import type * as events from "../events.js";
import type * as gettingStarted from "../gettingStarted.js";
import type * as googleSheets from "../googleSheets.js";
import type * as http from "../http.js";
import type * as judgeDirectory from "../judgeDirectory.js";
import type * as judging from "../judging.js";
import type * as judgingSheetSync from "../judgingSheetSync.js";
import type * as llmAnalytics from "../llmAnalytics.js";
import type * as luma from "../luma.js";
import type * as mcp from "../mcp.js";
import type * as mcpAdmin from "../mcpAdmin.js";
import type * as mcpAnalytics from "../mcpAnalytics.js";
import type * as mcpAuth from "../mcpAuth.js";
import type * as mcpConnectionPolicy from "../mcpConnectionPolicy.js";
import type * as mcpConsent from "../mcpConsent.js";
import type * as mcpData from "../mcpData.js";
import type * as mcpRuntime from "../mcpRuntime.js";
import type * as mcpSchema from "../mcpSchema.js";
import type * as mcpTools from "../mcpTools.js";
import type * as mcpWorkos from "../mcpWorkos.js";
import type * as members from "../members.js";
import type * as migrations from "../migrations.js";
import type * as organizationAuth from "../organizationAuth.js";
import type * as organizationStyles from "../organizationStyles.js";
import type * as phases from "../phases.js";
import type * as practice from "../practice.js";
import type * as scoreBasis from "../scoreBasis.js";
import type * as sponsors from "../sponsors.js";
import type * as tracks from "../tracks.js";
import type * as visualStyle from "../visualStyle.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminActionArgs: typeof adminActionArgs;
  ai: typeof ai;
  aiSummaries: typeof aiSummaries;
  aiSummaryAction: typeof aiSummaryAction;
  aiUsage: typeof aiUsage;
  analytics: typeof analytics;
  changeLog: typeof changeLog;
  changeWrap: typeof changeWrap;
  changes: typeof changes;
  crons: typeof crons;
  emails: typeof emails;
  eventOwnership: typeof eventOwnership;
  eventSlugs: typeof eventSlugs;
  eventTheme: typeof eventTheme;
  events: typeof events;
  gettingStarted: typeof gettingStarted;
  googleSheets: typeof googleSheets;
  http: typeof http;
  judgeDirectory: typeof judgeDirectory;
  judging: typeof judging;
  judgingSheetSync: typeof judgingSheetSync;
  llmAnalytics: typeof llmAnalytics;
  luma: typeof luma;
  mcp: typeof mcp;
  mcpAdmin: typeof mcpAdmin;
  mcpAnalytics: typeof mcpAnalytics;
  mcpAuth: typeof mcpAuth;
  mcpConnectionPolicy: typeof mcpConnectionPolicy;
  mcpConsent: typeof mcpConsent;
  mcpData: typeof mcpData;
  mcpRuntime: typeof mcpRuntime;
  mcpSchema: typeof mcpSchema;
  mcpTools: typeof mcpTools;
  mcpWorkos: typeof mcpWorkos;
  members: typeof members;
  migrations: typeof migrations;
  organizationAuth: typeof organizationAuth;
  organizationStyles: typeof organizationStyles;
  phases: typeof phases;
  practice: typeof practice;
  scoreBasis: typeof scoreBasis;
  sponsors: typeof sponsors;
  tracks: typeof tracks;
  visualStyle: typeof visualStyle;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  mcp: import("@convex-dev/mcp/_generated/component.js").ComponentApi<"mcp">;
  judgingDecisionHistory: import("@convex-dev/table-history/_generated/component.js").ComponentApi<"judgingDecisionHistory">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
