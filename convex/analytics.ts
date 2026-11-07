import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, type ActionCtx, type MutationCtx } from "./_generated/server";
import type { OrganizationPrincipal } from "./organizationAuth";
import { eventPhase } from "../lib/event-phase";
import { redactText } from "../lib/analytics-redact";

/**
 * Server-side product events and errors for PostHog. Every event name and its
 * properties are listed here, so free text cannot reach PostHog by accident:
 * the only free text sent is an error message or an MCP agent's intent, both
 * through the shared redactor.
 */
type Scalar = string | number | boolean;
type Phase = ReturnType<typeof eventPhase>;
/** An event with no properties of its own beyond the shared ones. */
type None = Record<never, never>;

export type ServerEvents = {
  event_created: { from_luma: boolean };
  phase_changed: { from: Phase; to: Phase };
  judges_added: { count: number };
  judge_link_replaced: None;
  judging_started: { judges: number; projects: number };
  judging_closed: { judges: number; projects: number };
  finalists_submitted: { count: number };
  placements_submitted: { count: number };
  lineup_shuffled: { method: "random" | "ai" | "manual" };
  presenter_picked: { position: number };
  presenter_skipped: { position: number };
  no_show_marked: { position: number };
  stage_mode_changed: { mode: "qr" | "demo" };
  timer_started: { timer: "stage" | "demo" | "judging"; seconds: number };
  members_invited: { count: number };
  /** `form_id` matches the browser's events from the same submit page load. */
  submission_submitted: { tracks: number; has_video: boolean; has_repository: boolean; team_size: number; form_id: string };
  status_link_requested: None;
  submission_withdrawn: None;
  ai_summary: {
    status: string;
    reason?: string;
    error?: string;
    statusCode?: number;
    errorType?: string;
    errorCode?: string;
    submission_id: string;
  };
  email_sent: { kind: string };
  email_failed: { kind: string; reason: string };
  judging_sheet_sync_failed: { reason: string };
};
export type ServerEventName = keyof ServerEvents;

/** What any event about one Demo Queue event may carry besides its own properties: `eventProperties` and nothing else. */
type Shared = Partial<ReturnType<typeof eventProperties>>;

/** Who an event is about. Organisers are their WorkOS user id; nobody else is identified. */
export type Actor =
  | { kind: "organiser"; userId: string; organizationId: string; surface?: "organiser" | "mcp" }
  | { kind: "anonymous"; surface: "team" | "judge" | "stage" }
  | { kind: "system" };

/** The WorkOS user id is the subject at the end of Convex's `issuer|subject` token identifier. */
export function organiser(principal: Pick<OrganizationPrincipal, "actor" | "organizationId" | "mcp">): Actor {
  return {
    kind: "organiser",
    userId: principal.actor.slice(principal.actor.lastIndexOf("|") + 1),
    organizationId: principal.organizationId,
    surface: principal.mcp ? "mcp" : "organiser",
  };
}

/** The properties every event about one Demo Queue event carries. */
export function eventProperties(event: Doc<"events">) {
  return {
    event_id: event._id,
    event_slug: event.slug,
    event_type: event.eventType ?? "demo",
    phase: eventPhase(event),
    practice: event.practice === true,
    ...(event.workosOrganizationId ? { organization_id: event.workosOrganizationId } : {}),
  };
}

type CapturedEvent = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };

const token = () => process.env.POSTHOG_PROJECT_TOKEN?.trim() || undefined;
const host = () => (process.env.POSTHOG_HOST?.trim() || "https://eu.i.posthog.com").replace(/\/$/, "");

function toCaptured(name: string, actor: Actor, properties: Record<string, unknown>, timestamp = Date.now()): CapturedEvent {
  const anonymous = actor.kind !== "organiser";
  return {
    event: name,
    // Anonymous events get a fresh id each: PostHog refuses ids like "anonymous",
    // and one shared id would merge every team and judge into one visitor.
    distinct_id: actor.kind === "organiser" ? actor.userId : actor.kind === "system" ? "system" : crypto.randomUUID(),
    properties: {
      ...properties,
      environment: process.env.POSTHOG_ENVIRONMENT?.trim() || "development",
      surface: actor.kind === "organiser" ? actor.surface ?? "organiser" : actor.kind === "system" ? "system" : actor.surface,
      ...(actor.kind === "organiser" && actor.organizationId ? { organization_id: actor.organizationId } : {}),
      ...(anonymous ? { $process_person_profile: false } : {}),
      $lib: "demo-queue-convex",
    },
    timestamp: new Date(timestamp).toISOString(),
  };
}

type Scheduler = Pick<MutationCtx | ActionCtx, "scheduler">;

/** PostHog's own properties start with "$", which Convex values cannot hold, so the batch travels as JSON. */
const schedule = (ctx: Scheduler, events: CapturedEvent[]) =>
  ctx.scheduler.runAfter(0, internal.analytics.capture, { batch: JSON.stringify(events) });

/**
 * Sends a product event once the calling mutation commits (or right away from
 * an action), through a scheduled action. Without a PostHog token nothing is
 * scheduled, so tests and deployments without analytics are unaffected.
 */
export async function track<Name extends ServerEventName>(
  ctx: Scheduler,
  name: Name,
  actor: Actor,
  properties: ServerEvents[Name] & Shared,
) {
  if (!token()) return;
  await schedule(ctx, [toCaptured(name, actor, properties)]);
}

/**
 * Events collected while an action runs and sent together when it ends, for
 * code that logs as it goes without a `ctx` at hand.
 */
export function eventBatch() {
  const events: CapturedEvent[] = [];
  return {
    add<Name extends ServerEventName>(name: Name, actor: Actor, properties: ServerEvents[Name] & Shared) {
      if (token()) events.push(toCaptured(name, actor, properties));
    },
    async send(ctx: Scheduler) {
      if (events.length > 0) await schedule(ctx, events.splice(0));
    },
  };
}
export type EventBatch = ReturnType<typeof eventBatch>;

/**
 * Reports an error caught in a Convex action as a PostHog `$exception`, with
 * its message redacted. `where` names the function, for grouping. Pass
 * `withMessage: false` where the message can quote model output or project
 * text, as AI SDK errors do; only the error's type is sent then.
 */
export async function trackException(ctx: Scheduler, error: unknown, actor: Actor, where: string, properties: Record<string, Scalar> = {}, { withMessage = true } = {}) {
  if (!token()) return;
  const type = error instanceof Error ? error.name : "Error";
  const message = withMessage ? redactText(error instanceof Error ? error.message : String(error)) : type;
  await schedule(ctx, [toCaptured("$exception", actor, {
    ...properties,
    function: where,
    $exception_list: [{ type, value: message, mechanism: { type: "generic", handled: true, synthetic: false } }],
  })]);
}

/**
 * One organiser MCP tool call, in the shape PostHog's MCP Analytics reads.
 * Arguments and results are never sent (`$mcp_parameters`, `$mcp_response`):
 * they hold team names, contact details and scores.
 */
export type McpToolCall = {
  $mcp_tool_name: string;
  $mcp_is_error: boolean;
  $mcp_duration_ms: number;
  $mcp_error_type?: "unauthorized" | "validation" | "not_found" | "operation_failed";
  /** Only one of the fixed admin messages, never an arbitrary error text. */
  $mcp_error_message?: string;
  $session_id?: string;
  $mcp_client_name?: string;
  $mcp_client_version?: string;
  /** The agent's `context` argument after `redactText(context, 300)`; omitted when blank. */
  $mcp_intent?: string;
  $mcp_intent_source?: "context_parameter";
};

/** Sends one `$mcp_tool_call`, timestamped when the call started. */
export async function trackMcpToolCall(ctx: Scheduler, actor: Actor, call: McpToolCall, startedAt: number) {
  if (!token()) return;
  await schedule(ctx, [toCaptured("$mcp_tool_call", actor, {
    ...call,
    $mcp_source: "posthog_mcp_analytics",
    $mcp_server_name: "demo-queue",
  }, startedAt)]);
}

/** Posts events to PostHog's batch endpoint. Failures are logged, never retried or thrown. */
async function sendToPostHog(events: CapturedEvent[]) {
  const apiKey = token();
  if (!apiKey || events.length === 0) return;
  try {
    const response = await fetch(`${host()}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, batch: events }),
    });
    if (!response.ok) console.error(JSON.stringify({ event: "posthog-capture-failed", status: response.status }));
  } catch {
    console.error(JSON.stringify({ event: "posthog-capture-failed", status: "network" }));
  }
}

export const capture = internalAction({
  args: { batch: v.string() },
  handler: async (_ctx, { batch }) => sendToPostHog(JSON.parse(batch) as CapturedEvent[]),
});
