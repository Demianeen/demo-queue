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
import type * as crons from "../crons.js";
import type * as eventOwnership from "../eventOwnership.js";
import type * as eventSlugs from "../eventSlugs.js";
import type * as eventTheme from "../eventTheme.js";
import type * as events from "../events.js";
import type * as googleSheets from "../googleSheets.js";
import type * as http from "../http.js";
import type * as judging from "../judging.js";
import type * as mcp from "../mcp.js";
import type * as mcpAdmin from "../mcpAdmin.js";
import type * as mcpAuth from "../mcpAuth.js";
import type * as mcpData from "../mcpData.js";
import type * as mcpSchema from "../mcpSchema.js";
import type * as mcpTools from "../mcpTools.js";
import type * as organizationAuth from "../organizationAuth.js";
import type * as organizationStyles from "../organizationStyles.js";
import type * as visualStyle from "../visualStyle.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminActionArgs: typeof adminActionArgs;
  ai: typeof ai;
  crons: typeof crons;
  eventOwnership: typeof eventOwnership;
  eventSlugs: typeof eventSlugs;
  eventTheme: typeof eventTheme;
  events: typeof events;
  googleSheets: typeof googleSheets;
  http: typeof http;
  judging: typeof judging;
  mcp: typeof mcp;
  mcpAdmin: typeof mcpAdmin;
  mcpAuth: typeof mcpAuth;
  mcpData: typeof mcpData;
  mcpSchema: typeof mcpSchema;
  mcpTools: typeof mcpTools;
  organizationAuth: typeof organizationAuth;
  organizationStyles: typeof organizationStyles;
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
  judgingDecisionHistory: import("@convex-dev/table-history/_generated/component.js").ComponentApi<"judgingDecisionHistory">;
};
