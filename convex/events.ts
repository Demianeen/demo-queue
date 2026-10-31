import { paginationOptsValidator } from "convex/server";
import {
  requireOrganization,
  requireEventOrganization,
  requireOwnedEvent,
  type OrganizationPrincipal,
} from "./organizationAuth";
import { findEventBySlug } from "./eventSlugs";
import { ConvexError, v, type Infer, type ObjectType } from "convex/values";
import {
  DatabaseReader,
  DatabaseWriter,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import {
  emailKey,
  isValidEmail,
  meetUrlError,
  parseContactTextFields,
  parseSubmissionTextFields,
  socialLinksError,
  type ContactTextInput,
  type SubmissionTextInput,
} from "../lib/validation";
import {
  MAX_ADDITIONAL_TEAM_MEMBERS,
  MAX_HACKATHON_VIDEO_URL_LENGTH,
  normalizeHackathonVideoUrl,
  normalizeGithubRepositoryUrl,
  MAX_TEAM_MEMBER_NAME_LENGTH,
  MAX_TEAM_NAME_LENGTH,
} from "../lib/hackathon";
import { judgeKeyOf, judgeNameKey, parseRoundOneJudges } from "../lib/judging-assignment";
import { participantLineupStatus } from "../lib/event-state";
import { eventPhase } from "../lib/event-phase";
import { DEFAULT_EVENT_THEME } from "../lib/event-theme";
import { MAX_ORGANIZATION_STYLES, normalizeVisualStyle } from "../lib/visual-style";
import {
  parseTeamContact,
  type TeamContact,
  type TeamContactInput,
} from "../lib/team-contacts";
import { visualStyleValidator } from "./visualStyle";
import { queueJudgingSheetSync } from "./judgingSheetSync";
import {
  insertEventTracks,
  listEventTracks,
  normalizeTrackSelection,
  publicTrack,
  trackInputValidator,
  trackNamesFor,
  tracksById,
} from "./tracks";
import { insertEventSponsors, listEventSponsors, publicSponsor, sponsorInputValidator } from "./sponsors";
import { emailConfig } from "./emails";
import { publicAiRead, publicAiSummary, queueAiSummaryIfStale } from "./aiSummaries";
import { lumaOrganizationAllowed, queueLumaImport, participantSocialEditPatch, participantSocials, socialEditPatch, typedSocialSources } from "./luma";
import { ZodError } from "zod";
import { amountOfTime, submissionTitle, withChange } from "./changeWrap";
import { changeSummaryName, insertChange, recordChange } from "./changeLog";
import { judgingRemaining, phaseFields } from "./phases";
import { addJudgesToEvent, removeJudgeFromEvent, REVIEW_TARGET } from "./judging";
import { loadJudgeDirectory } from "./judgeDirectory";
import { isJudgedStatus } from "../lib/judged-status";

const STAGE_LINEUP_LIMIT = 10;
const DEFAULT_STAGE_TIMER_MS = 5 * 60 * 1000;
const DEFAULT_DEMO_TIMER_MS = 2 * 60 * 1000;
const MIN_STAGE_TIMER_DURATION_MS = 60 * 1000;
const MAX_STAGE_TIMER_MS = 99 * 60 * 1000;
const MIN_STAGE_TIMER_MS = 0;
const MIN_OVERTIME_TIMER_MS = -MAX_STAGE_TIMER_MS;
const ORPHAN_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_UPLOAD_BATCH_SIZE = 50;
type PublicStageTimerStatus = "idle" | "running" | "paused";
type StageScreenMode = "qr" | "demo";
type EventType = "demo" | "hackathon";

function eventType(event: Doc<"events">): EventType {
  return event.eventType ?? "demo";
}

function stageScreenMode(event: Doc<"events">): StageScreenMode {
  return event.stageScreenMode ?? (event.queuePublished ? "demo" : "qr");
}

type TracksById = ReadonlyMap<Id<"eventTracks">, Doc<"eventTracks">>;

const publicSubmissionFields = (submission: Doc<"submissions">, byId: TracksById) => ({
  id: submission._id,
  name: submission.name,
  demoTitle: submission.demoTitle,
  description: submission.description,
  tracks: trackNamesFor(submission, byId),
  teamName: submission.teamName,
  githubUrl: submission.githubUrl,
  status: submission.status,
  queueOrder: submission.queueOrder,
});

const adminSubmissionFields = (
  submission: Doc<"submissions">,
  byId: TracksById,
  teamMemberContacts: Array<
    Pick<Doc<"teamMembers">, "name" | "email" | "whatsappPhone" | "twitter" | "linkedin" | "githubProfile">
  > = [],
  videoUrl: string | null = null,
) => ({
  ...publicSubmissionFields(submission, byId),
  trackIds: submission.trackIds ?? [],
  phone: submission.phone,
  email: submission.email,
  twitter: submission.twitter,
  linkedin: submission.linkedin,
  githubProfile: submission.githubProfile,
  participantToken: submission.participantToken,
  screenshotId: submission.screenshotId,
  teamMembers: teamMemberContacts.map((member) => member.name),
  teamMemberContacts: teamMemberContacts.map((member) => ({
    name: member.name,
    email: member.email,
    whatsappPhone: member.whatsappPhone,
    twitter: member.twitter,
    linkedin: member.linkedin,
    githubProfile: member.githubProfile,
  })),
  videoUrl: submission.videoUrl ?? videoUrl,
  videoDeleteAt: submission.videoDeleteAt,
  videoDeletedAt: submission.videoDeletedAt,
  rulesAcceptedAt: submission.rulesAcceptedAt,
  aiSummary: publicAiSummary(submission),
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
});

/** The judging timer as the organiser sees it. */
function judgingTimerView(event: Doc<"events">, now = Date.now()) {
  return {
    status: event.judgingTimerStatus ?? "idle",
    remainingMs: judgingRemaining(event, now),
    durationMs: event.judgingTimerDurationMs ?? null,
    endsAt: event.judgingTimerStatus === "running" ? event.judgingTimerEndsAt ?? null : null,
    serverNow: now,
  };
}

/** Practice events tidy away this long after their last change (Proposed). */
export const PRACTICE_TIDY_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** What admin pages show about a practice event, or null for a real one. */
export function practiceView(event: Doc<"events">) {
  if (event.practice !== true) return null;
  return {
    ownerUserId: event.practiceOwnerActor ? /\|(user_[A-Za-z0-9]+)$/.exec(event.practiceOwnerActor)?.[1] ?? null : null,
    copiedFromName: event.practiceCopiedFromName ?? null,
    tidiesAwayAt: event.updatedAt + PRACTICE_TIDY_AFTER_MS,
    aiSummaries: event.practiceAiSummaries ?? "sample",
  };
}

async function eventBySlug(ctx: { db: DatabaseReader }, slug: string) {
  const event = await findEventBySlug(ctx, slug);

  if (!event) {
    throw new ConvexError("Event not found");
  }

  return event;
}


function sortQueue(a: Doc<"submissions">, b: Doc<"submissions">) {
  return (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER);
}

// The lineup is the ordered running order: every "queued" submission, sorted by
// queueOrder. Position 0 is "now demoing" (current), position 1 is "up next".
function lineupSorted(submissions: Doc<"submissions">[]) {
  return submissions.filter((submission) => submission.status === "queued").sort(sortQueue);
}

function clampTimerMs(value: number, fallbackMs = DEFAULT_STAGE_TIMER_MS) {
  if (!Number.isFinite(value)) {
    return fallbackMs;
  }

  return Math.max(MIN_STAGE_TIMER_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(value)));
}

function clampSignedTimerMs(value: number, fallbackMs = DEFAULT_STAGE_TIMER_MS) {
  if (!Number.isFinite(value)) {
    return fallbackMs;
  }

  return Math.max(MIN_OVERTIME_TIMER_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(value)));
}

function stageTimerDuration(event: Doc<"events">) {
  return clampTimerDurationMs(event.stageTimerDurationMs ?? DEFAULT_STAGE_TIMER_MS);
}

function demoTimerDuration(event: Doc<"events">) {
  return clampTimerDurationMs(event.demoTimerDurationMs ?? DEFAULT_DEMO_TIMER_MS, DEFAULT_DEMO_TIMER_MS);
}

function clampTimerDurationMs(value: number, fallbackMs = DEFAULT_STAGE_TIMER_MS) {
  if (!Number.isFinite(value)) {
    return fallbackMs;
  }

  return Math.max(
    MIN_STAGE_TIMER_DURATION_MS,
    Math.min(MAX_STAGE_TIMER_MS, Math.round(value)),
  );
}

function currentStageTimerRemaining(event: Doc<"events">, now: number) {
  const durationMs = stageTimerDuration(event);

  if (event.stageTimerStatus === "running" && event.stageTimerEndsAt !== undefined) {
    return clampSignedTimerMs(event.stageTimerEndsAt - now);
  }

  return event.stageTimerStatus === "paused"
    ? clampSignedTimerMs(event.stageTimerRemainingMs ?? durationMs)
    : clampTimerMs(event.stageTimerRemainingMs ?? durationMs);
}

function currentDemoTimerRemaining(event: Doc<"events">, now: number) {
  const durationMs = demoTimerDuration(event);

  if (event.demoTimerStatus === "running" && event.demoTimerEndsAt !== undefined) {
    return clampSignedTimerMs(event.demoTimerEndsAt - now);
  }

  return event.demoTimerStatus === "paused"
    ? clampSignedTimerMs(event.demoTimerRemainingMs ?? durationMs)
    : clampTimerMs(event.demoTimerRemainingMs ?? durationMs);
}

function publicStageTimer(event: Doc<"events">, now = Date.now()) {
  const durationMs = stageTimerDuration(event);
  const remainingMs = currentStageTimerRemaining(event, now);
  const status: PublicStageTimerStatus = event.stageTimerStatus ?? "idle";

  return {
    status,
    durationMs,
    remainingMs,
    endsAt: event.stageTimerStatus === "running" ? event.stageTimerEndsAt : undefined,
    serverNow: now,
  };
}

function publicDemoTimer(event: Doc<"events">, now = Date.now()) {
  const durationMs = demoTimerDuration(event);
  const remainingMs = currentDemoTimerRemaining(event, now);
  const status: PublicStageTimerStatus = event.demoTimerStatus ?? "idle";

  return {
    status,
    durationMs,
    remainingMs,
    endsAt: event.demoTimerStatus === "running" ? event.demoTimerEndsAt : undefined,
    serverNow: now,
  };
}

async function logAction(
  ctx: { db: DatabaseWriter },
  eventId: Id<"events">,
  action: string,
  actor: string,
  details?: string,
) {
  await ctx.db.insert("auditLog", {
    eventId,
    action,
    actor,
    details,
    createdAt: Date.now(),
  });
}

function zodToConvexError(error: unknown): never {
  if (error instanceof ZodError) {
    throw new ConvexError(error.issues[0]?.message ?? "Invalid submission.");
  }
  throw error;
}

async function clearAdvanceSnapshot(ctx: { db: DatabaseWriter }, event: Doc<"events">, now = Date.now()) {
  if (event.lastAdvanceSnapshot === undefined) return;
  await ctx.db.patch(event._id, {
    lastAdvanceSnapshot: undefined,
    updatedAt: now,
  });
}

function normalizeSubmissionTextFields(args: SubmissionTextInput): ReturnType<typeof parseSubmissionTextFields> {
  try {
    return parseSubmissionTextFields(args);
  } catch (error) {
    zodToConvexError(error);
  }
}

function normalizeContactTextFields(args: ContactTextInput): ReturnType<typeof parseContactTextFields> {
  try {
    return parseContactTextFields(args);
  } catch (error) {
    zodToConvexError(error);
  }
}

async function trackSelection(
  ctx: Pick<QueryCtx, "db">,
  event: Doc<"events">,
  trackIds: Id<"eventTracks">[] | undefined,
): Promise<{ trackIds?: Id<"eventTracks">[] }> {
  if (trackIds === undefined) return {};
  return { trackIds: await normalizeTrackSelection(ctx, event._id, trackIds) };
}

export const EMAIL_TAKEN_MESSAGE =
  "You already submitted with this email. Check your inbox for your status link.";
// Wait this long before emailing the same status link again.
const STATUS_LINK_RESEND_MS = 2 * 60 * 1000;
type EmailOwner = { submission: Doc<"submissions">; email: string };
type SubmissionStatus = Doc<"submissions">["status"];

/*
 * Email uniqueness. Invariant: in one event, at most one row across
 * submissions and team members holds a given normalizedEmail, and only rows of
 * submissions that hold emails (not withdrawn or hidden) hold one. Every write
 * keeps it through two helpers: emailFields for any email written onto a row,
 * and patchSubmissionStatus for any status change. A lookup then reads at
 * most two rows per table.
 */

/** Withdrawn and hidden submissions free their emails; every other status holds them. */
export function holdsEmails(status: SubmissionStatus) {
  return status !== "withdrawn" && status !== "hidden";
}

/** The stored lookup key: emailKey(email) while the row holds it, otherwise "". */
export function storedEmailKey(email: string | undefined, holds: boolean) {
  return holds && email?.trim() ? emailKey(email) : "";
}

export const EMAIL_RESTORE_TAKEN_MESSAGE =
  "Another submission in this event now uses an email from this one. Change that email first.";
// Rows written before normalizedEmail existed, read until the backfill has run.
const LEGACY_EMAIL_SCAN_LIMIT = 1000;

async function emailOwners(ctx: Pick<QueryCtx, "db">, eventId: Id<"events">, key: string): Promise<EmailOwner[]> {
  const [submissions, members, legacySubmissions, legacyMembers] = await Promise.all([
    ctx.db.query("submissions").withIndex("by_event_and_normalized_email", (q) => q.eq("eventId", eventId).eq("normalizedEmail", key)).take(2),
    ctx.db.query("teamMembers").withIndex("by_event_and_normalized_email", (q) => q.eq("eventId", eventId).eq("normalizedEmail", key)).take(2),
    ctx.db.query("submissions").withIndex("by_event_and_normalized_email", (q) => q.eq("eventId", eventId).eq("normalizedEmail", undefined)).take(LEGACY_EMAIL_SCAN_LIMIT + 1),
    ctx.db.query("teamMembers").withIndex("by_event_and_normalized_email", (q) => q.eq("eventId", eventId).eq("normalizedEmail", undefined)).take(LEGACY_EMAIL_SCAN_LIMIT + 1),
  ]);
  if (legacySubmissions.length > LEGACY_EMAIL_SCAN_LIMIT || legacyMembers.length > LEGACY_EMAIL_SCAN_LIMIT) {
    console.error("Email lookup refused: run migrations:backfillNormalizedEmails", { eventId });
    throw new ConvexError("Email checks are being updated. Try again in a few minutes.");
  }
  if (submissions.length + members.length > 1) {
    console.error("Email lookup found more than one row holding one email", {
      eventId,
      rows: [...submissions, ...members].map((row) => row._id),
    });
  }
  const matches = (row: { email?: string }) => Boolean(row.email) && emailKey(row.email!) === key;
  const owners: EmailOwner[] = [];
  for (const submission of [...submissions, ...legacySubmissions.filter(matches)]) {
    if (holdsEmails(submission.status)) owners.push({ submission, email: submission.email! });
  }
  for (const member of [...members, ...legacyMembers.filter(matches)]) {
    const submission = await ctx.db.get(member.submissionId);
    if (submission && holdsEmails(submission.status)) owners.push({ submission, email: member.email! });
  }
  return owners;
}

/** Rejects emails that repeat within one submission. */
function assertDistinctEmails(emails: Array<string | undefined>) {
  const keys = emails.filter((email): email is string => Boolean(email?.trim())).map(emailKey);
  if (new Set(keys).size !== keys.length) throw new ConvexError("Each person needs a different email.");
}

/**
 * The one way to write an email onto a submission or team member row. When
 * the row holds emails, checks no other submission in the event uses it.
 * Returns the email with its lookup key, to spread into the insert or patch.
 */
async function emailFields(
  ctx: Pick<QueryCtx, "db">,
  eventId: Id<"events">,
  email: string | undefined,
  options: { ownSubmissionId?: Id<"submissions">; holds?: boolean; takenMessage?: string } = {},
) {
  const holds = options.holds ?? true;
  const normalizedEmail = storedEmailKey(email, holds);
  if (normalizedEmail) {
    const owners = await emailOwners(ctx, eventId, normalizedEmail);
    if (owners.some((owner) => owner.submission._id !== options.ownSubmissionId)) {
      throw new ConvexError(options.takenMessage ?? EMAIL_TAKEN_MESSAGE);
    }
  }
  return { email, normalizedEmail };
}

/**
 * The one way to change a submission's status. Leaving the statuses that hold
 * emails clears the lookup keys on the submission and its team members; coming
 * back checks every email again and refuses if another submission took one.
 */
async function patchSubmissionStatus(
  ctx: MutationCtx,
  submission: Doc<"submissions">,
  patch: { status: SubmissionStatus; queueOrder?: number | undefined; updatedAt: number },
) {
  const holds = holdsEmails(patch.status);
  if (holds !== holdsEmails(submission.status)) {
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    if (holds) assertDistinctEmails([submission.email, ...members.map((member) => member.email)]);
    const options = { ownSubmissionId: submission._id, holds, takenMessage: EMAIL_RESTORE_TAKEN_MESSAGE };
    await ctx.db.patch(submission._id, await emailFields(ctx, submission.eventId, submission.email, options));
    for (const member of members) {
      await ctx.db.patch(member._id, await emailFields(ctx, submission.eventId, member.email, options));
    }
  }
  await ctx.db.patch(submission._id, {
    ...patch,
    ...(submission.status === "withdrawn" && patch.status !== "withdrawn" ? { withdrawnFromStatus: undefined, withdrawnBy: undefined } : {}),
  });
}

/**
 * Emails the status link to an address already on an entry in this event,
 * at most once every two minutes per entry, through the email rate limits.
 */
async function emailStatusLinkToOwner(ctx: MutationCtx, owner: EmailOwner) {
  const now = Date.now();
  if (owner.submission.statusLinkEmailedAt !== undefined && now - owner.submission.statusLinkEmailedAt < STATUS_LINK_RESEND_MS) return;
  await ctx.db.patch(owner.submission._id, { statusLinkEmailedAt: now });
  await ctx.scheduler.runAfter(0, internal.emails.sendStatusLinkEmail, { submissionId: owner.submission._id, to: owner.email, reason: "resend" });
}

/** Emails the team their status link once the submission is saved. */
async function queueSubmittedEmail(ctx: MutationCtx, submissionId: Id<"submissions">, now: number) {
  await ctx.db.patch(submissionId, { statusLinkEmailedAt: now });
  await ctx.scheduler.runAfter(0, internal.emails.sendStatusLinkEmail, { submissionId, reason: "submitted" });
}

function assertSocialLinks(links: { twitter?: string; linkedin?: string; githubProfile?: string }) {
  const message = socialLinksError(links);
  if (message) throw new ConvexError(message);
}

function normalizeTeamName(value: string) {
  const teamName = value.trim();
  if (!teamName) throw new ConvexError("Team name is required.");
  if (teamName.length > MAX_TEAM_NAME_LENGTH) {
    throw new ConvexError(`Team name must be ${MAX_TEAM_NAME_LENGTH} characters or fewer.`);
  }
  return teamName;
}

function normalizeTeamMembers(values: string[]) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length > MAX_ADDITIONAL_TEAM_MEMBERS) {
    throw new ConvexError(`Add no more than ${MAX_ADDITIONAL_TEAM_MEMBERS} additional team members.`);
  }
  for (const name of unique) {
    if (name.length > MAX_TEAM_MEMBER_NAME_LENGTH) {
      throw new ConvexError(
        `Team member names must be ${MAX_TEAM_MEMBER_NAME_LENGTH} characters or fewer.`,
      );
    }
  }
  return unique;
}

function normalizeTeamContact(value: TeamContactInput): TeamContact {
  try {
    return parseTeamContact(value);
  } catch (error) {
    zodToConvexError(error);
  }
}

function normalizeTeamMemberContacts(values: TeamContactInput[]) {
  if (values.length > MAX_ADDITIONAL_TEAM_MEMBERS) {
    throw new ConvexError(`Add no more than ${MAX_ADDITIONAL_TEAM_MEMBERS} additional team members.`);
  }
  return values.map(normalizeTeamContact);
}

function normalizeArchivedGoogleDriveVideo(value: string) {
  const normalized = normalizeHackathonVideoUrl(value);
  if (!normalized) return null;

  const url = new URL(normalized);
  const fileMatch = url.pathname.match(/^\/file\/d\/([^/]+)\/view$/);
  if (url.hostname !== "drive.google.com" || !fileMatch) {
    return null;
  }
  return { videoUrl: normalized, fileId: fileMatch[1] };
}

async function resolveSubmissionVideoUrl(
  ctx: Pick<QueryCtx, "storage">,
  submission: Pick<Doc<"submissions">, "videoUrl" | "videoStorageId">,
) {
  if (submission.videoUrl) return submission.videoUrl;
  if (!submission.videoStorageId) return null;
  return await ctx.storage.getUrl(submission.videoStorageId);
}

async function requireUnattachedSubmissionFile(ctx: MutationCtx, storageId: Id<"_storage">) {
  const [screenshotSubmission, videoSubmission] = await Promise.all([
    ctx.db
      .query("submissions")
      .withIndex("by_screenshot_id", (q) => q.eq("screenshotId", storageId))
      .first(),
    ctx.db
      .query("submissions")
      .withIndex("by_video_storage_id", (q) => q.eq("videoStorageId", storageId))
      .first(),
  ]);
  if (screenshotSubmission || videoSubmission) {
    throw new ConvexError("That uploaded file is already attached to a submission.");
  }
}

export function blankEventState(now: number) {
  return {
    queuePublished: false,
    stageScreenMode: "qr" as const,
    showSubmissionCountOnStage: false,
    showMeetLinkOnStage: false,
    showStageTimerOnStage: false,
    stageTimerStatus: "idle" as const,
    stageTimerDurationMs: DEFAULT_STAGE_TIMER_MS,
    stageTimerRemainingMs: DEFAULT_STAGE_TIMER_MS,
    stageTimerEndsAt: undefined,
    showDemoTimerOnStage: false,
    demoTimerStatus: "idle" as const,
    demoTimerDurationMs: DEFAULT_DEMO_TIMER_MS,
    demoTimerRemainingMs: DEFAULT_DEMO_TIMER_MS,
    demoTimerEndsAt: undefined,
    lineupTarget: undefined,
    lastAdvanceSnapshot: undefined,
    phase: undefined,
    finishedAt: undefined,
    updatedAt: now,
  };
}

export async function deleteSubmissionData(
  ctx: MutationCtx,
  event: Doc<"events">,
  submissions: Doc<"submissions">[],
) {
  const teamMembers = await ctx.db
    .query("teamMembers")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .collect();

  for (const member of teamMembers) {
    await ctx.db.delete(member._id);
  }

  for (const submission of submissions) {
    if (submission.screenshotId) await ctx.storage.delete(submission.screenshotId);
    if (submission.videoStorageId) await ctx.storage.delete(submission.videoStorageId);
    await ctx.db.delete(submission._id);
  }
}

export const createEventArgs = {
    expectedOrganizationId: v.string(),
    name: v.string(),
    slug: v.string(),
    eventType: v.union(v.literal("demo"), v.literal("hackathon")),
    visualStyle: v.optional(visualStyleValidator),
    styleId: v.optional(v.id("organizationStyles")),
    // A demo night needs one; a hackathon has none (an empty string).
    meetUrl: v.optional(v.string()),
  };

type CreateEventInput = ObjectType<typeof createEventArgs>;

export const createEvent = mutation({
  args: { ...createEventArgs, tracks: v.optional(v.array(trackInputValidator)), sponsors: v.optional(v.array(sponsorInputValidator)) },
  handler: async (ctx, { tracks, sponsors, ...args }) => {
    const { organizationId, actor } = await requireOrganization(ctx);
    if (args.expectedOrganizationId !== organizationId) {
      throw new ConvexError("Your organization changed. Reload events before creating an event.");
    }
    return createOrganizationEvent(ctx, args, { organizationId, actor }, tracks, sponsors);
  },
});

export async function createOrganizationEvent(
  ctx: MutationCtx,
  args: CreateEventInput,
  { organizationId, actor }: { organizationId: string; actor: string },
  tracks: Infer<typeof trackInputValidator>[] = [],
  sponsors: Infer<typeof sponsorInputValidator>[] = [],
) {
    const name = args.name.trim();
    if (!name || name.length > 160) throw new ConvexError("Enter an event name of 1–160 characters.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug) || args.slug.length > 200) {
      throw new ConvexError("Invalid event slug.");
    }
    const meetError = meetUrlError(args.eventType, args.meetUrl);
    if (meetError) throw new ConvexError(meetError);
    const existing = await findEventBySlug(ctx, args.slug);
    const alias = await ctx.db.query("eventSlugAliases").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();

    if (existing || alias) {
      throw new ConvexError("That event slug already exists");
    }

    const selectedStyle = args.styleId ? await ctx.db.get(args.styleId) : null;
    if (args.styleId && (!selectedStyle || selectedStyle.organizationId !== organizationId)) throw new ConvexError("Style not found.");
    const defaultStyle = !args.styleId && !args.visualStyle
      ? (await ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES)).find((style) => style.isDefault)
      : null;
    // With no choice and no organization default (an assistant may leave the
    // style out), the event starts in Base, the plain style. New event in the
    // app always sends a choice.
    const resolvedStyle = selectedStyle ?? defaultStyle;
    const visualStyle = resolvedStyle ? resolvedStyle.preset ?? "neutral" : args.visualStyle ?? "neutral";
    const theme = visualStyle === "neutral" ? (selectedStyle ?? defaultStyle)?.theme ?? DEFAULT_EVENT_THEME : undefined;
    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      name,
      workosOrganizationId: organizationId,
      slug: args.slug,
      eventType: args.eventType,
      visualStyle,
      theme,
      meetUrl: args.meetUrl?.trim() ?? "",
      queuePublished: false,
      stageScreenMode: "qr",
      showSubmissionCountOnStage: false,
      showMeetLinkOnStage: false,
      showStageTimerOnStage: false,
      showDemoTimerOnStage: false,
      demoTimerDurationMs: DEFAULT_DEMO_TIMER_MS,
      createdAt: now,
      updatedAt: now,
    });

    await insertEventTracks(ctx, eventId, tracks);
    // Sponsors are a hackathon's; the AI read checks each project for them.
    if (args.eventType === "hackathon") await insertEventSponsors(ctx, eventId, sponsors);
    else if (sponsors.some((sponsor) => sponsor.name.trim())) throw new ConvexError("Sponsors are for hackathons.");
    await logAction(ctx, eventId, "event_created", actor);
    return { eventId };
}

export const listOrganizationEvents = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { organizationId } = await requireOrganization(ctx);
    // Real events only: practice events are listed apart, in practice.listPracticeEvents.
    const result = await ctx.db.query("events")
      .withIndex("by_workosOrganizationId_and_practice", (q) => q.eq("workosOrganizationId", organizationId).eq("practice", undefined))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      organizationId,
      page: result.page.map((event) => ({
        id: event._id,
        name: event.name,
        slug: event.slug,
        eventType: eventType(event),
        createdAt: event.createdAt,
        organizationId,
        phase: phaseFields(event).phase,
      })),
    };
  },
});

export const getLiveEventArgs = v.object({});

/**
 * The organization's live event: the newest real event that is not
 * finished (Proposed). There is one at a time per organization for now.
 * Never a practice event. Null when there is none.
 */
export async function getLiveEventForOrganization(
  ctx: QueryCtx,
  _args: Infer<typeof getLiveEventArgs>,
  principal: OrganizationPrincipal,
) {
  const recent = await ctx.db.query("events")
    .withIndex("by_workosOrganizationId_and_practice", (q) => q.eq("workosOrganizationId", principal.organizationId).eq("practice", undefined))
    .order("desc")
    .take(20);
  const event = recent.find((candidate) => phaseFields(candidate).phase !== "finished");
  if (!event) return null;
  return { id: event._id, name: event.name, slug: event.slug, eventType: eventType(event), createdAt: event.createdAt, ...phaseFields(event) };
}

export const getLiveEvent = query({
  args: getLiveEventArgs,
  handler: async (ctx, args) => getLiveEventForOrganization(ctx, args, await requireOrganization(ctx)),
});

/** Finalists who did not pitch in the final, so the stage leaves them out of the finalists list. */
const NOT_PITCHED: ReadonlySet<string> = new Set(["no_show", "withdrawn", "hidden"]);

type SubmittedResults = {
  winners: { place: 1 | 2 | 3; submissionId: Id<"submissions">; demoTitle: string; teamName: string }[];
  finalists: { submissionId: Id<"submissions">; demoTitle: string; teamName: string }[];
};

/**
 * A hackathon's winners and its other finalists, once judging is closed and
 * both are submitted. "needs_review" when the submitted winners no longer
 * hold (a project removed or no longer a finalist); null before they are
 * submitted. The finalists left over keep their pitch order, leaving out a
 * no-show and a withdrawn or hidden project: the stage lists everyone else
 * who pitched in the final.
 */
async function submittedResults(ctx: QueryCtx, event: Doc<"events">, decision: Doc<"judgingDecisions"> | null): Promise<SubmittedResults | "needs_review" | null> {
  if (eventType(event) !== "hackathon" || event.judgingStatus !== "closed") return null;
  if (decision?.finalistStatus !== "submitted" || decision.placementStatus !== "submitted") return null;
  const placed = await Promise.all(decision.placementIds.map((id) => ctx.db.get(id)));
  const valid = placed.length > 0 && placed.length <= 3 && new Set(decision.placementIds).size === placed.length
    && placed.every((submission) => submission && submission.eventId === event._id && decision.finalistIds.includes(submission._id));
  if (!valid) return "needs_review";
  const placedIds = new Set(decision.placementIds.map(String));
  const others = await Promise.all(decision.finalistIds.filter((id) => !placedIds.has(String(id))).map((id) => ctx.db.get(id)));
  const named = (submission: Doc<"submissions">) => ({ submissionId: submission._id, demoTitle: submission.demoTitle, teamName: submission.teamName || submission.name });
  return {
    winners: placed.map((submission, index) => ({ place: (index + 1) as 1 | 2 | 3, ...named(submission!) })),
    finalists: others.filter((submission): submission is Doc<"submissions"> => submission !== null && submission.eventId === event._id && !NOT_PITCHED.has(submission.status)).map(named),
  };
}

/** The results the stage and status pages show: only once the event is finished, never before. */
async function finishedResults(ctx: QueryCtx, event: Doc<"events">) {
  if (phaseFields(event).phase !== "finished") return null;
  const decision = await ctx.db.query("judgingDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).unique();
  const results = await submittedResults(ctx, event, decision);
  return results === "needs_review" ? null : results;
}

export const getOrganizationEventDetailsArgs = v.object({ slug: v.string() });

export async function getOrganizationEventDetailsForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getOrganizationEventDetailsArgs>,
  principal: OrganizationPrincipal,
) {
    const { slug } = args;
    const { organizationId } = principal;
    const event = await findEventBySlug(ctx, slug);
    if (!event || event.workosOrganizationId !== organizationId) return null;
    const isHackathon = eventType(event) === "hackathon";
    const [submissions, decision, reviews] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1001),
      ctx.db.query("judgingDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).unique(),
      isHackathon ? ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(4000) : [],
    ]);
    // The event tabs' counts: presenters in the lineup, and judging scores in of the scores needed.
    const judgingIds = new Set(submissions.filter((submission) => isJudgedStatus(submission.status)).map((submission) => String(submission._id)));
    // A helper's extra review never counts past a project's target.
    const perProject = new Map<string, number>();
    for (const review of reviews) {
      const id = String(review.submissionId);
      if (review.completed && judgingIds.has(id)) perProject.set(id, (perProject.get(id) ?? 0) + 1);
    }
    const scores = isHackathon
      ? { complete: [...perProject.values()].reduce((sum, count) => sum + Math.min(count, REVIEW_TARGET), 0), target: judgingIds.size * REVIEW_TARGET }
      : null;
    let resultsStatus: "not_applicable" | "pending" | "needs_review" | "confirmed" = isHackathon ? (decision?.placementStatus === "needs_review" || decision?.finalistStatus === "needs_review") ? "needs_review" : "pending" : "not_applicable";
    let winners: { place: number; demoTitle: string; teamName: string }[] = [];
    const results = await submittedResults(ctx, event, decision);
    if (results === "needs_review") resultsStatus = "needs_review";
    else if (results) {
      winners = results.winners.map(({ place, demoTitle, teamName }) => ({ place, demoTitle, teamName }));
      resultsStatus = "confirmed";
    }
    return {
      organizationId, name: event.name, slug: event.slug, eventType: eventType(event),
      createdAt: event.createdAt,
      visualStyle: normalizeVisualStyle(event.visualStyle), theme: event.theme,
      submissionsClosed: event.submissionsClosedAt !== undefined, queuePublished: event.queuePublished,
      ...phaseFields(event), practice: practiceView(event),
      judgingStatus: isHackathon ? event.judgingStatus ?? "setup" : null,
      submissionCount: Math.min(submissions.length, 1000), submissionCountCapped: submissions.length > 1000,
      lineupCount: submissions.filter((submission) => submission.status === "queued").length, scores,
      resultsStatus, winners,
    };
}

export const getOrganizationEventDetails = query({
  args: getOrganizationEventDetailsArgs,
  handler: async (ctx, args) =>
    getOrganizationEventDetailsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getEventMeta = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await eventBySlug(ctx, slug);

    return {
      name: event.name,
      slug: event.slug,
      eventType: eventType(event),
      // The submit page's loading state wears the event's look.
      visualStyle: normalizeVisualStyle(event.visualStyle),
      theme: event.theme,
    };
  },
});

export const getAdminEventMetaArgs = v.object({ slug: v.string(), });

export async function getAdminEventMetaForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getAdminEventMetaArgs>,
  principal: OrganizationPrincipal,
) {
    const { slug } = args;
    const { event } = await requireOwnedEvent(ctx, slug, principal);

    return {
      name: event.name,
      slug: event.slug,
      eventType: eventType(event),
    };
}

export const getAdminEventMeta = query({
  args: getAdminEventMetaArgs,
  handler: async (ctx, args) =>
    getAdminEventMetaForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const getParticipantMeta = query({
  args: { slug: v.string(), participantToken: v.string() },
  handler: async (ctx, { slug, participantToken }) => {
    const event = await eventBySlug(ctx, slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    return {
      event: {
        name: event.name,
        slug: event.slug,
        eventType: eventType(event),
        submissionsClosed: event.submissionsClosedAt !== undefined,
      },
      submission: {
        demoTitle: submission.demoTitle,
      },
    };
  },
});

export const getStage = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await eventBySlug(ctx, slug);
    const now = Date.now();
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const tracks = await listEventTracks(ctx, event._id);
    const byId = tracksById(tracks);
    const stageFields = (submission: Doc<"submissions">) => publicSubmissionFields(submission, byId);

    const lineup = lineupSorted(submissions);
    const activeSubmissionCount = submissions.filter(
      (submission) => submission.status === "queued" || submission.status === "candidate",
    ).length;
    const stageLineup = event.queuePublished ? lineup.slice(0, STAGE_LINEUP_LIMIT) : [];
    const current = stageLineup[0] ?? null;
    const upNext = stageLineup[1] ?? null;
    const showMeetLinkOnStage = event.showMeetLinkOnStage ?? false;
    const { phase } = phaseFields(event);
    const results = await finishedResults(ctx, event);

    return {
      phase,
      event: {
        name: event.name,
        slug: event.slug,
        eventType: eventType(event),
        visualStyle: normalizeVisualStyle(event.visualStyle),
        theme: event.theme,
        submissionsClosed: event.submissionsClosedAt !== undefined,
        queuePublished: event.queuePublished,
        stageScreenMode: stageScreenMode(event),
        showSubmissionCountOnStage: event.showSubmissionCountOnStage ?? false,
        showMeetLinkOnStage,
        showStageTimerOnStage: event.showStageTimerOnStage ?? false,
        showDemoTimerOnStage: event.showDemoTimerOnStage ?? false,
        tracks: tracks.map(publicTrack),
        // Whether the submit form can prefill socials from Luma. Never the Luma id.
        lumaLinked: Boolean(event.lumaEventId) && lumaOrganizationAllowed(event.workosOrganizationId),
      },
      stageTimer: publicStageTimer(event, now),
      demoTimer: publicDemoTimer(event, now),
      // While judges score, the stage's clock is the judging clock, the same one judges see.
      judgingTimer: phase === "judging" ? judgingTimerView(event, now) : null,
      current: current ? stageFields(current) : null,
      upNext: upNext ? stageFields(upNext) : null,
      lineup: stageLineup.map(stageFields),
      remainingCount: lineup.length,
      waitingCount: activeSubmissionCount,
      meetUrl: event.queuePublished && showMeetLinkOnStage && event.meetUrl ? event.meetUrl : null,
      // The winners screen: only once the event is finished and the winners are submitted.
      results: results ? {
        winners: results.winners.map(({ place, demoTitle, teamName }) => ({ place, demoTitle, teamName })),
        finalists: results.finalists.map(({ demoTitle, teamName }) => ({ demoTitle, teamName })),
        showFinalists: event.stageResultsShowFinalists ?? true,
      } : null,
    };
  },
});

export const getAdminArgs = v.object({ slug: v.string(), });

export async function getAdminForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getAdminArgs>,
  principal: OrganizationPrincipal,
) {
    const { slug } = args;
    const { event } = await requireOwnedEvent(ctx, slug, principal);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const teamMembers = await ctx.db
      .query("teamMembers")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const membersBySubmission = new Map<string, Doc<"teamMembers">[]>();
    for (const member of teamMembers) {
      const members = membersBySubmission.get(member.submissionId) ?? [];
      members.push(member);
      membersBySubmission.set(member.submissionId, members);
    }
    const tracks = await listEventTracks(ctx, event._id);
    const sponsors = await listEventSponsors(ctx, event._id);
    const byId = tracksById(tracks);
    const trackCounts = new Map<Id<"eventTracks">, number>();
    let noTrackCount = 0;
    for (const submission of submissions) {
      const ids = submission.trackIds ?? [];
      if (ids.length === 0 && !(submission.trackIds === undefined && submission.category)) noTrackCount += 1;
      for (const id of ids) trackCounts.set(id, (trackCounts.get(id) ?? 0) + 1);
    }
    const judges = await loadJudgeDirectory(ctx, event);
    const adminSubmissions = await Promise.all(
      submissions.map(async (submission) => ({
        ...adminSubmissionFields(
          submission,
          byId,
          membersBySubmission.get(submission._id) ?? [],
          await resolveSubmissionVideoUrl(ctx, submission),
        ),
        // The judges' names to show (the judging sheet writes these), and their keys.
        roundOneAssignedJudges: submission.roundOneAssignedJudges?.map(judges.nameOf),
        roundOneAssignedJudgeKeys: submission.roundOneAssignedJudges?.map(judgeKeyOf),
        aiRead: publicAiRead(event, submission, byId, sponsors),
      })),
    );
    const submissionById = new Map(adminSubmissions.map((submission) => [submission.id, submission]));
    const mapAdminSubmission = (submission: Doc<"submissions">) =>
      submissionById.get(submission._id)!;

    return {
      event: {
        id: event._id,
        name: event.name,
        slug: event.slug,
        eventType: eventType(event),
        meetUrl: event.meetUrl,
        judgingSheetId: event.judgingSheetId,
        judgingSheetUrl: event.judgingSheetUrl,
        judgingSheetCreatedAt: event.judgingSheetCreatedAt,
        judgingSheetSyncRevision: event.judgingSheetSyncRevision ?? 0,
        judgingSheetSyncedRevision: event.judgingSheetSyncedRevision ?? 0,
        judgingSheetSyncedAt: event.judgingSheetSyncedAt,
        judgingSheetSyncError: event.judgingSheetSyncError,
        roundOneJudges: event.roundOneJudges ?? [],
        submissionCount: submissions.length,
        queuePublished: event.queuePublished,
        stageScreenMode: stageScreenMode(event),
        showSubmissionCountOnStage: event.showSubmissionCountOnStage ?? false,
        showMeetLinkOnStage: event.showMeetLinkOnStage ?? false,
        showStageTimerOnStage: event.showStageTimerOnStage ?? false,
        showDemoTimerOnStage: event.showDemoTimerOnStage ?? false,
        stageResultsShowFinalists: event.stageResultsShowFinalists ?? true,
        lineupTarget: event.lineupTarget,
        stageTimer: publicStageTimer(event),
        demoTimer: publicDemoTimer(event),
        canRestorePrevious: event.lastAdvanceSnapshot !== undefined,
        submissionSurgeAt: event.submissionSurgeAt,
        // Where the event is (Submissions, Judging, Stage, Finished) and which phases it has.
        ...phaseFields(event),
        judgingStatus: eventType(event) === "hackathon" ? event.judgingStatus ?? "setup" : null,
        judgingTimer: eventType(event) === "hackathon" ? judgingTimerView(event) : null,
        practice: practiceView(event),
        luma: {
          // Only organisations that own the key's Luma calendar can link.
          available: lumaOrganizationAllowed(event.workosOrganizationId),
          event: event.lumaEventId
            ? { id: event.lumaEventId, name: event.lumaEventName ?? event.lumaEventId, url: event.lumaEventUrl ?? null }
            : null,
        },
      },
      tracks: tracks.map((track) => ({ ...publicTrack(track), submissionCount: trackCounts.get(track._id) ?? 0 })),
      sponsors: sponsors.map(publicSponsor),
      noTrackCount,
      legacyCategoryCount: submissions.filter((submission) => submission.trackIds === undefined && submission.category).length,
      lineup: lineupSorted(submissions).map(mapAdminSubmission),
      pool: submissions
        .filter((submission) => submission.status === "candidate")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(mapAdminSubmission),
      hidden: submissions
        .filter((submission) => submission.status === "hidden")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(mapAdminSubmission),
      completed: submissions
        .filter((submission) => submission.status === "done")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(mapAdminSubmission),
      noShows: submissions
        .filter((submission) => submission.status === "no_show")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(mapAdminSubmission),
      withdrawn: submissions
        .filter((submission) => submission.status === "withdrawn")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(mapAdminSubmission),
    };
}

export const getAdmin = query({
  args: getAdminArgs,
  handler: async (ctx, args) =>
    getAdminForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const getParticipant = query({
  args: { slug: v.string(), participantToken: v.string() },
  handler: async (ctx, { slug, participantToken }) => {
    const event = await eventBySlug(ctx, slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    // Current/up-next are positional: index 0 and 1 of the published lineup.
    const allSubmissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const lineup = lineupSorted(allSubmissions);
    const lineupIndex = lineup.findIndex((entry) => entry._id === submission._id);

    const liveStatus = participantLineupStatus(
      submission.status,
      lineupIndex,
      event.queuePublished,
    );

    // Anyone in the published lineup can see the Meet link (lineupIndex >= 0),
    // not just the current/up-next speakers. Pool/candidate entries (index -1)
    // still don't get it until they're added to the lineup.
    const mayJoin = event.queuePublished && lineupIndex >= 0;
    const teamMembers = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const byId = tracksById(await listEventTracks(ctx, event._id));
    const results = await finishedResults(ctx, event);
    const placement = results?.winners.find((winner) => winner.submissionId === submission._id)?.place ?? null;

    return {
      event: {
        name: event.name,
        slug: event.slug,
        eventType: eventType(event),
        visualStyle: normalizeVisualStyle(event.visualStyle),
        theme: event.theme,
        submissionsClosed: event.submissionsClosedAt !== undefined,
        // Where the event is, for the team's steps (Submitted, Judging, Finalists, Results).
        phase: eventPhase({ ...event, eventType: eventType(event) }),
        lumaLinked: Boolean(event.lumaEventId) && lumaOrganizationAllowed(event.workosOrganizationId),
      },
      submission: {
        ...publicSubmissionFields(submission, byId),
        status: liveStatus,
        phone: submission.phone,
        email: submission.email,
        // Only what people typed: Luma-imported socials are for organisers and judges.
        ...participantSocials(submission),
        githubUrl: submission.githubUrl,
        rulesAcceptedAt: submission.rulesAcceptedAt,
        finalist: submission.finalist ?? false,
        // 1st, 2nd or 3rd, only once the event is finished; never before.
        placement,
        teamMembers: teamMembers.map((member) => member.name),
        // Each member's typed socials, so the team can fill in or correct them. No emails or phones.
        teamMemberSocials: teamMembers.map((member) => ({
          id: member._id,
          name: member.name,
          ...participantSocials(member),
        })),
        videoUrl: await resolveSubmissionVideoUrl(ctx, submission),
        videoDeleteAt: submission.videoDeleteAt,
        videoDeletedAt: submission.videoDeletedAt,
        createdAt: submission.createdAt,
        // Withdraw only while waiting or in the lineup; Submit again only for the team's own withdraw.
        canWithdraw: submission.status === "candidate" || submission.status === "queued",
        canSubmitAgain: canSubmitAgain(submission),
      },
      meetUrl: mayJoin && event.meetUrl ? event.meetUrl : null,
    };
  },
});

/**
 * What a participant sent, for the submit page when it is reopened in the
 * browser that submitted. The participant token is the capability, as on the
 * status page. Answers null instead of throwing for a stale token.
 */
export const getSubmittedView = query({
  args: { slug: v.string(), participantToken: v.string() },
  handler: async (ctx, { slug, participantToken }) => {
    const event = await findEventBySlug(ctx, slug);
    if (!event) return null;
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", participantToken))
      .unique();
    if (!submission || submission.eventId !== event._id) return null;
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .take(MAX_ADDITIONAL_TEAM_MEMBERS + 1);
    const byId = tracksById(await listEventTracks(ctx, event._id));

    return {
      eventType: eventType(event),
      emailConfigured: emailConfig().ok,
      submittedAt: submission.createdAt,
      withdrawn: submission.status === "withdrawn",
      email: submission.email,
      teamName: submission.teamName,
      demoTitle: submission.demoTitle,
      description: submission.description,
      tracks: trackNamesFor(submission, byId),
      githubUrl: submission.githubUrl,
      videoUrl: await resolveSubmissionVideoUrl(ctx, submission),
      people: [
        {
          name: submission.name,
          presenter: true,
          ...participantSocials(submission),
        },
        ...members.map((member) => ({
          name: member.name,
          presenter: false,
          ...participantSocials(member),
        })),
      ],
    };
  },
});

/**
 * Limits for the public submit page. Submits are refused per browser and per
 * email, never for the whole event: a full event bucket only logs and warns
 * the organiser, so nobody can lock real participants out. A browser can
 * change its id; organisers hide what gets through.
 *
 * The instant check and a submit both answer whether an email is taken, so
 * they draw on the same per browser budget. A submit spends its tokens before
 * looking at emails and answers "taken" as a result, not an error, so the
 * spent tokens commit. Everything that can fail runs before that point.
 */
export const PUBLIC_FORM_LIMITS = {
  emailCheckPerCaller: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  // Only the instant check: when it runs out the form shows nothing and submit still checks.
  emailCheckPerEvent: { kind: "token bucket", rate: 2000, period: HOUR, capacity: 300 },
  submitPerCaller: { kind: "token bucket", rate: 10, period: HOUR, capacity: 3 },
  // Bounds withdraw and resubmit rounds with one email.
  submitPerEmail: { kind: "token bucket", rate: 6, period: HOUR, capacity: 3 },
  // Soft: never refuses, only marks the event so the admin shows a warning.
  submitPerEvent: { kind: "token bucket", rate: 600, period: HOUR, capacity: 200 },
} as const;

const publicFormLimiter = new RateLimiter(components.rateLimiter, PUBLIC_FORM_LIMITS);

export const EMAIL_CHECK_LIMITED_MESSAGE = "Too many email checks. Try again in a few minutes.";
export const SUBMIT_LIMITED_MESSAGE = "Too many submissions from this browser. Try again in a few minutes.";
export const SUBMIT_EMAIL_LIMITED_MESSAGE = "Too many submissions with this email. Try again in an hour.";
// Mark the event again at most this often while submissions keep pouring in.
const SUBMISSION_SURGE_MARK_MS = 10 * 60 * 1000;
const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/;

function assertClientId(clientId: string) {
  if (!CLIENT_ID.test(clientId)) throw new ConvexError("Reload the page and try again.");
}

async function limitEmailCheck(ctx: MutationCtx, eventId: Id<"events">, clientId: string) {
  assertClientId(clientId);
  const perCaller = await publicFormLimiter.limit(ctx, "emailCheckPerCaller", { key: `${eventId}:${clientId}` });
  if (!perCaller.ok) throw new ConvexError(EMAIL_CHECK_LIMITED_MESSAGE);
  const perEvent = await publicFormLimiter.limit(ctx, "emailCheckPerEvent", { key: eventId });
  if (!perEvent.ok) throw new ConvexError(EMAIL_CHECK_LIMITED_MESSAGE);
}

/** Refuses per browser and per email; an event-wide surge only warns the organiser. */
async function limitSubmit(ctx: MutationCtx, event: Doc<"events">, clientId: string, emails: Array<string | undefined>) {
  assertClientId(clientId);
  const callerKey = { key: `${event._id}:${clientId}` };
  const perCaller = await publicFormLimiter.limit(ctx, "submitPerCaller", callerKey);
  if (!perCaller.ok) throw new ConvexError(SUBMIT_LIMITED_MESSAGE);
  // A submit also answers "is this email taken", so it spends the instant check's budget too.
  const asked = await publicFormLimiter.limit(ctx, "emailCheckPerCaller", callerKey);
  if (!asked.ok) throw new ConvexError(SUBMIT_LIMITED_MESSAGE);
  for (const email of emails) {
    if (!email?.trim()) continue;
    const perEmail = await publicFormLimiter.limit(ctx, "submitPerEmail", { key: `${event._id}:${emailKey(email)}` });
    if (!perEmail.ok) throw new ConvexError(SUBMIT_EMAIL_LIMITED_MESSAGE);
  }
  const perEvent = await publicFormLimiter.limit(ctx, "submitPerEvent", { key: event._id });
  if (!perEvent.ok) {
    const now = Date.now();
    if (event.submissionSurgeAt === undefined || now - event.submissionSurgeAt > SUBMISSION_SURGE_MARK_MS) {
      console.warn("Submission surge", { eventId: event._id });
      await ctx.db.patch(event._id, { submissionSurgeAt: now });
    }
  }
}

/** What a public submit answers when an email is already in the event; the spent limits commit. */
const EMAIL_TAKEN_RESULT = { emailTaken: true } as const;

/** emailFields for the public form: null instead of an error when the email is taken. */
async function publicEmailFields(ctx: MutationCtx, eventId: Id<"events">, email: string | undefined) {
  try {
    return await emailFields(ctx, eventId, email);
  } catch (error) {
    if (error instanceof ConvexError && error.data === EMAIL_TAKEN_MESSAGE) return null;
    throw error;
  }
}

/**
 * Whether someone in this event already submitted with this email, as a
 * presenter or a team member. Never says which submission.
 */
/** A mutation rather than a query, so every answer counts against the limits. */
export const checkSubmissionEmail = mutation({
  args: { slug: v.string(), email: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const key = emailKey(args.email);
    if (!isValidEmail(key)) throw new ConvexError("Enter a valid email address.");
    const event = await findEventBySlug(ctx, args.slug);
    // Says nothing about events that are not taking submissions.
    if (!event || event.submissionsClosedAt !== undefined) return { taken: false };
    await limitEmailCheck(ctx, event._id, args.clientId);
    return { taken: (await emailOwners(ctx, event._id, key)).length > 0 };
  },
});

/**
 * Emails the private status link again to an address already in this event.
 * Answers the same way whether or not the address is known, and sends at
 * most once every two minutes per submission.
 */
export const requestStatusLinkEmail = mutation({
  args: { slug: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const key = emailKey(args.email);
    if (!isValidEmail(key)) throw new ConvexError("Enter a valid email address.");
    const event = await eventBySlug(ctx, args.slug);
    const [owner] = await emailOwners(ctx, event._id, key);
    if (owner) await emailStatusLinkToOwner(ctx, owner);
    return { ok: true };
  },
});

export const submitDemoArgs = {
    slug: v.string(),
    participantToken: v.string(),
    clientId: v.string(),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    githubProfile: v.optional(v.string()),
    category: v.optional(v.string()),
    trackIds: v.optional(v.array(v.id("eventTracks"))),
    screenshotId: v.optional(v.id("_storage")),
    queueOrder: v.number(),
};

/** Options for test people in a practice event, which go through the same submit code. */
type SubmitOptions = { practiceTest?: boolean };

export const submitDemo = mutation({
  args: submitDemoArgs,
  handler: async (ctx, args) => submitDemoForEvent(ctx, await eventBySlug(ctx, args.slug), args),
});

export async function submitDemoForEvent(ctx: MutationCtx, event: Doc<"events">, args: ObjectType<typeof submitDemoArgs>, options: SubmitOptions = {}) {
    if (eventType(event) !== "demo") {
      throw new ConvexError("Use the hackathon submission form for this event.");
    }
    if (event.submissionsClosedAt !== undefined) throw new ConvexError("Submissions are closed.");
    const now = Date.now();
    const fields = normalizeSubmissionTextFields(args);
    assertSocialLinks(fields);
    const tracks = await trackSelection(ctx, event, args.trackIds);
    if (args.screenshotId) await requireUnattachedSubmissionFile(ctx, args.screenshotId);
    if (!options.practiceTest) await limitSubmit(ctx, event, args.clientId, [fields.email]);
    const email = await publicEmailFields(ctx, event._id, fields.email);
    if (!email) return EMAIL_TAKEN_RESULT;

    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      ...fields,
      ...email,
      ...tracks,
      screenshotId: args.screenshotId,
      socialSources: typedSocialSources(fields),
      // New submissions land in the pool ("all people"); the admin drags chosen
      // people into the lineup.
      status: "candidate",
      queueOrder: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(event._id, { updatedAt: now });
    await logAction(ctx, event._id, "submission_created", "participant", submissionId);
    if (options.practiceTest) await logAction(ctx, event._id, TEST_PEOPLE_ACTION, "practice", submissionId);
    // Test people send no email: it would only spend the daily allowance real participants need.
    if (!options.practiceTest) await queueSubmittedEmail(ctx, submissionId, now);
    if (!options.practiceTest) await queueLumaImport(ctx, event, submissionId);
    return { submissionId };
}

/** The audit action the Getting started guide reads as "test people were added". */
export const TEST_PEOPLE_ACTION = "test_submission_admin_added";

export const submitHackathonArgs = {
    slug: v.string(),
    participantToken: v.string(),
    clientId: v.string(),
    name: v.string(),
    teamName: v.string(),
    teamMembers: v.array(v.string()),
    teamMemberContacts: v.optional(
      v.array(
        v.object({
          name: v.string(),
          email: v.string(),
          whatsappPhone: v.string(),
          twitter: v.optional(v.string()),
          linkedin: v.optional(v.string()),
          githubProfile: v.optional(v.string()),
        }),
      ),
    ),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    githubProfile: v.optional(v.string()),
    category: v.optional(v.string()),
    trackIds: v.optional(v.array(v.id("eventTracks"))),
    githubUrl: v.string(),
    rulesAccepted: v.boolean(),
    videoUrl: v.string(),
};

export const submitHackathon = mutation({
  args: submitHackathonArgs,
  handler: async (ctx, args) => submitHackathonForEvent(ctx, await eventBySlug(ctx, args.slug), args),
});

export async function submitHackathonForEvent(ctx: MutationCtx, event: Doc<"events">, args: ObjectType<typeof submitHackathonArgs>, options: SubmitOptions = {}) {
    if (eventType(event) !== "hackathon") {
      throw new ConvexError("This event accepts personal demo submissions.");
    }
    if (event.submissionsClosedAt !== undefined) throw new ConvexError("Submissions are closed.");

    const now = Date.now();
    const fields = normalizeSubmissionTextFields(args);
    // The optional contact payload distinguishes the new team-grid client from
    // stale clients during rollout. New clients get strict per-person contact
    // validation; legacy clients retain their existing submission contract.
    const presenter = args.teamMemberContacts
      ? normalizeTeamContact({
          name: fields.name,
          email: fields.email ?? "",
          whatsappPhone: fields.phone,
        })
      : null;
    const teamName = normalizeTeamName(args.teamName);
    const teamMemberContacts = args.teamMemberContacts
      ? normalizeTeamMemberContacts(args.teamMemberContacts)
      : [];
    const teamMembers = args.teamMemberContacts
      ? teamMemberContacts.map((member) => member.name)
      : normalizeTeamMembers(args.teamMembers);
    const githubUrl = normalizeGithubRepositoryUrl(args.githubUrl);
    const videoUrl = normalizeHackathonVideoUrl(args.videoUrl);
    if (!githubUrl) {
      throw new ConvexError("Enter a valid public GitHub repository URL.");
    }
    if (!videoUrl) {
      throw new ConvexError(
        `Enter a valid HTTPS video link up to ${MAX_HACKATHON_VIDEO_URL_LENGTH} characters.`,
      );
    }
    if (!args.rulesAccepted) {
      throw new ConvexError("Confirm that your submission meets the event rules.");
    }
    assertSocialLinks(fields);
    const emails = [presenter?.email ?? fields.email, ...teamMemberContacts.map((member) => member.email)];
    assertDistinctEmails(emails);
    const tracks = await trackSelection(ctx, event, args.trackIds);
    if (!options.practiceTest) await limitSubmit(ctx, event, args.clientId, emails);
    const presenterEmail = await publicEmailFields(ctx, event._id, emails[0]);
    if (!presenterEmail) return EMAIL_TAKEN_RESULT;
    const memberEmails = [];
    for (const contact of teamMemberContacts) {
      const memberEmail = await publicEmailFields(ctx, event._id, contact.email);
      if (!memberEmail) return EMAIL_TAKEN_RESULT;
      memberEmails.push(memberEmail);
    }
    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      ...fields,
      ...tracks,
      name: presenter?.name ?? fields.name,
      phone: presenter?.whatsappPhone ?? fields.phone,
      ...presenterEmail,
      teamName,
      githubUrl,
      videoUrl,
      socialSources: typedSocialSources(fields),
      rulesAcceptedAt: now,
      status: "candidate",
      queueOrder: undefined,
      createdAt: now,
      updatedAt: now,
    });

    for (const [index, memberName] of teamMembers.entries()) {
      const contact = teamMemberContacts[index];
      await ctx.db.insert("teamMembers", {
        eventId: event._id,
        submissionId,
        name: memberName,
        ...(memberEmails[index] ?? (await emailFields(ctx, event._id, undefined))),
        whatsappPhone: contact?.whatsappPhone,
        twitter: contact?.twitter,
        linkedin: contact?.linkedin,
        githubProfile: contact?.githubProfile,
        socialSources: typedSocialSources(contact ?? {}),
        createdAt: now,
      });
    }

    await ctx.db.patch(event._id, { updatedAt: now });
    await logAction(ctx, event._id, "hackathon_submission_created", "participant", submissionId);
    if (options.practiceTest) await logAction(ctx, event._id, TEST_PEOPLE_ACTION, "practice", submissionId);
    await queueJudgingSheetSync(ctx, event);
    // Test people send no email: it would only spend the daily allowance real participants need.
    if (!options.practiceTest) await queueSubmittedEmail(ctx, submissionId, now);
    if (!options.practiceTest) await queueLumaImport(ctx, event, submissionId);
    // Participants cannot edit after submitting, so the summary can be written now.
    const submitted = await ctx.db.get(submissionId);
    if (submitted) await queueAiSummaryIfStale(ctx, event, submitted, 0, { source: "participant" });
    return { submissionId };
}

export const adminAddSubmissionArgs = v.object({
  slug: v.string(),
  participantToken: v.string(),
  name: v.string(),
  demoTitle: v.string(),
  description: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  twitter: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  githubProfile: v.optional(v.string()),
  category: v.optional(v.string()),
  trackIds: v.optional(v.array(v.id("eventTracks"))),
  queueOrder: v.number(),
  list: v.optional(v.union(v.literal("lineup"), v.literal("pool"))),
});

async function adminAddSubmissionOperation(
  ctx: MutationCtx,
  args: Infer<typeof adminAddSubmissionArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (eventType(event) !== "demo") {
      throw new ConvexError("Add hackathon teams through the public submission form.");
    }
    const now = Date.now();
    const toPool = args.list === "pool";
    const fields = normalizeSubmissionTextFields(args);
    const tracks = await trackSelection(ctx, event, args.trackIds);
    const email = await emailFields(ctx, event._id, fields.email);

    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      ...fields,
      ...email,
      ...tracks,
      socialSources: typedSocialSources(fields),
      status: toPool ? "candidate" : "queued",
      queueOrder: toPool ? undefined : args.queueOrder,
      createdAt: now,
      updatedAt: now,
    });

    await logAction(ctx, event._id, "submission_admin_added", actor, submissionId);
    await queueLumaImport(ctx, event, submissionId);
    return { submissionId };
}

export const adminAddSubmission = mutation({
  args: adminAddSubmissionArgs,
  handler: async (ctx, args) =>
    adminAddSubmissionForOrganization(ctx, args, await requireOrganization(ctx)),
});

const adminTestSubmissionValidator = v.object({
  participantToken: v.string(),
  name: v.string(),
  demoTitle: v.string(),
  description: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  twitter: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  category: v.optional(v.string()),
  trackIds: v.optional(v.array(v.id("eventTracks"))),
  teamName: v.optional(v.string()),
  teamMembers: v.optional(v.array(v.string())),
  githubUrl: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
});

export const adminAddTestSubmissionsArgs = v.object({
  slug: v.string(),
  submissions: v.array(adminTestSubmissionValidator),
});

async function adminAddTestSubmissionsOperation(
  ctx: MutationCtx,
  args: Infer<typeof adminAddTestSubmissionsArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (event.submissionsClosedAt !== undefined) {
      throw new ConvexError("Submissions are closed.");
    }
    if (args.submissions.length < 1 || args.submissions.length > 25) {
      throw new ConvexError("Add between 1 and 25 test submissions at a time.");
    }

    const isHackathon = eventType(event) === "hackathon";
    const now = Date.now();
    const submissionIds: Id<"submissions">[] = [];
    for (const submission of args.submissions) {
      const fields = normalizeSubmissionTextFields(submission);
      const teamName = isHackathon ? normalizeTeamName(submission.teamName ?? "") : undefined;
      const teamMembers = isHackathon ? normalizeTeamMembers(submission.teamMembers ?? []) : [];
      const githubUrl = isHackathon
        ? normalizeGithubRepositoryUrl(
            submission.githubUrl ?? `https://github.com/demo-queue/test-project-${submissionIds.length + 1}`,
          ) ?? undefined
        : undefined;
      const videoUrl = isHackathon && submission.videoUrl
        ? normalizeHackathonVideoUrl(submission.videoUrl) ?? undefined
        : undefined;
      const tracks = await trackSelection(ctx, event, submission.trackIds);
      // Rows inserted earlier in this batch already hold their emails, so repeats are caught too.
      const email = await emailFields(ctx, event._id, fields.email);
      const submissionId = await ctx.db.insert("submissions", {
        eventId: event._id,
        participantToken: submission.participantToken,
        ...fields,
        ...email,
        ...tracks,
        teamName,
        githubUrl,
        videoUrl,
        rulesAcceptedAt: isHackathon ? now : undefined,
        status: "candidate",
        queueOrder: undefined,
        createdAt: now,
        updatedAt: now,
      });

      for (const memberName of teamMembers) {
        await ctx.db.insert("teamMembers", {
          eventId: event._id,
          submissionId,
          name: memberName,
          ...(await emailFields(ctx, event._id, undefined)),
          createdAt: now,
        });
      }

      await logAction(ctx, event._id, "test_submission_admin_added", actor, submissionId);
      submissionIds.push(submissionId);
    }

    await ctx.db.patch(event._id, { updatedAt: now });
    await queueJudgingSheetSync(ctx, event);
    return { submissionIds };
}

export const adminAddTestSubmissions = mutation({
  args: adminAddTestSubmissionsArgs,
  handler: async (ctx, args) =>
    adminAddTestSubmissionsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const editParticipantContact = mutation({
  args: {
    slug: v.string(),
    participantToken: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    // Sent by current clients ("" to clear); left alone when missing.
    githubProfile: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", args.participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    const { githubProfile, ...contact } = normalizeContactTextFields(args);
    assertSocialLinks({ ...contact, githubProfile });
    const email = await emailFields(ctx, event._id, contact.email, {
      ownSubmissionId: submission._id,
      holds: holdsEmails(submission.status),
    });
    const socials = {
      twitter: contact.twitter,
      linkedin: contact.linkedin,
      ...(args.githubProfile !== undefined ? { githubProfile } : {}),
    };
    const { patch, emailChanged } = participantSocialEditPatch(submission, socials, contact.email);
    await ctx.db.patch(submission._id, {
      ...contact,
      ...email,
      ...patch,
      updatedAt: Date.now(),
    });
    await queueJudgingSheetSync(ctx, event);
    // No new import once submissions are closed.
    if (emailChanged && event.submissionsClosedAt === undefined) await queueLumaImport(ctx, event, submission._id);
  },
});

/**
 * A team member's socials, corrected from the private status page. The
 * participant token is the capability, as for the presenter's contact info.
 * What is saved counts as typed, so a later Luma import never replaces it.
 */
export const editTeamMemberSocials = mutation({
  args: {
    slug: v.string(),
    participantToken: v.string(),
    memberId: v.id("teamMembers"),
    twitter: v.string(),
    linkedin: v.string(),
    githubProfile: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", args.participantToken))
      .unique();
    const member = await ctx.db.get(args.memberId);
    if (!submission || submission.eventId !== event._id || !member || member.submissionId !== submission._id) {
      throw new ConvexError("Submission not found");
    }
    const { twitter, linkedin, githubProfile } = normalizeSubmissionTextFields({
      name: member.name, demoTitle: "", description: "", phone: "",
      twitter: args.twitter, linkedin: args.linkedin, githubProfile: args.githubProfile,
    });
    assertSocialLinks({ twitter, linkedin, githubProfile });
    const { patch } = participantSocialEditPatch(member, { twitter, linkedin, githubProfile }, member.email);
    await ctx.db.patch(member._id, patch);
    await ctx.db.patch(submission._id, { updatedAt: Date.now() });
    await queueJudgingSheetSync(ctx, event);
  },
});

export const WITHDRAW_HIDDEN_MESSAGE = "The event team hid this entry, so it can't be withdrawn here. Ask them instead.";
export const WITHDRAW_ACTED_ON_MESSAGE = "The event team has already moved this entry on, so it can't be withdrawn here. Ask them instead.";

/** Whether the team can Submit again: they withdrew it themselves, from candidate or queued. */
export function canSubmitAgain(submission: Pick<Doc<"submissions">, "status" | "withdrawnBy" | "withdrawnFromStatus">) {
  return submission.status === "withdrawn" && submission.withdrawnBy === "participant" &&
    (submission.withdrawnFromStatus === "candidate" || submission.withdrawnFromStatus === "queued");
}

export const withdrawSubmission = mutation({
  args: { slug: v.string(), participantToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", args.participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }
    if (event.submissionsClosedAt !== undefined) throw new ConvexError("Submissions are closed.");
    if (submission.status === "withdrawn") return;
    // Only an entry still waiting or in the lineup: never one the event team hid or moved on.
    if (submission.status === "hidden") throw new ConvexError(WITHDRAW_HIDDEN_MESSAGE);
    if (submission.status !== "candidate" && submission.status !== "queued") throw new ConvexError(WITHDRAW_ACTED_ON_MESSAGE);

    await patchSubmissionStatus(ctx, submission, { status: "withdrawn", updatedAt: Date.now() });
    await ctx.db.patch(submission._id, { withdrawnFromStatus: submission.status, withdrawnBy: "participant" });
    await logAction(ctx, event._id, "submission_withdrawn", "participant", submission._id);
    await queueJudgingSheetSync(ctx, event);
  },
});

export const SUBMIT_AGAIN_CLOSED_MESSAGE = "Submissions have closed.";
export const SUBMIT_AGAIN_TAKEN_MESSAGE = "An entry with this email already exists. We've emailed its status link to that address.";
export const SUBMIT_AGAIN_NOT_ALLOWED_MESSAGE = "This entry can't be submitted again here. Ask the event team.";

/**
 * Submit again (Proposed): brings a withdrawn entry back while submissions
 * are open, with all its details and the same status link. The participant
 * token is the capability, as for withdraw. The submit limits apply. It does
 * nothing for an entry that is not withdrawn, and refuses one the team did
 * not withdraw themselves from candidate or queued. It returns to that
 * status. When another entry now holds one of its emails, it says so with a
 * generic message and emails that entry's status link to the address on
 * file; it never returns another entry's link or token.
 */
export const resubmitWithdrawnSubmission = mutation({
  args: { slug: v.string(), participantToken: v.string(), clientId: v.string() },
  handler: async (ctx, args): Promise<{ restored: true } | { restored: false; reason: "not_withdrawn" } | { restored: false; reason: "email_taken"; message: string }> => {
    const event = await eventBySlug(ctx, args.slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", args.participantToken))
      .unique();
    if (!submission || submission.eventId !== event._id) throw new ConvexError("Submission not found");
    if (submission.status !== "withdrawn") return { restored: false, reason: "not_withdrawn" };
    if (!canSubmitAgain(submission)) throw new ConvexError(SUBMIT_AGAIN_NOT_ALLOWED_MESSAGE);
    if (event.submissionsClosedAt !== undefined) throw new ConvexError(SUBMIT_AGAIN_CLOSED_MESSAGE);

    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const emails = [submission.email, ...members.map((member) => member.email)];
    // The same limits as a submit, so withdraw and submit again can't be looped.
    await limitSubmit(ctx, event, args.clientId, emails);

    for (const email of emails) {
      if (!email?.trim()) continue;
      const owner = (await emailOwners(ctx, event._id, emailKey(email))).find((row) => row.submission._id !== submission._id);
      if (!owner) continue;
      // The link goes to the address on that entry, never back to the caller.
      await emailStatusLinkToOwner(ctx, owner);
      return { restored: false, reason: "email_taken", message: SUBMIT_AGAIN_TAKEN_MESSAGE };
    }

    const now = Date.now();
    // Back to where it was: the pool, or the end of the lineup.
    let queueOrder: number | undefined;
    if (submission.withdrawnFromStatus === "queued") {
      const lineup = lineupSorted(await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect());
      queueOrder = Math.max(0, ...lineup.map((entry) => entry.queueOrder ?? 0)) + 1;
    }
    await patchSubmissionStatus(ctx, submission, { status: submission.withdrawnFromStatus!, queueOrder, updatedAt: now });
    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "submission_resubmitted", "participant", submission._id);
    await insertChange(ctx, {
      event, principal: { actor: "participant" }, byParticipant: true,
      kind: "submission_resubmitted", summary: `submitted ${changeSummaryName(submission)} again after withdrawing it`,
      subjectId: submission._id, undo: "none",
      noUndoReason: "The team brought this back themselves. Hide it if it should not take part.",
    }, []);
    await queueJudgingSheetSync(ctx, event);
    const restored = await ctx.db.get(submission._id);
    if (restored) await queueAiSummaryIfStale(ctx, event, restored, 0, { source: "participant" });
    return { restored: true };
  },
});

export const updateEvent = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    meetUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireOrganization(ctx);
    const { event } = await requireOwnedEvent(ctx, args.slug, principal);
    const name = args.name.trim();
    const meetError = meetUrlError(eventType(event), args.meetUrl);
    if (meetError) throw new ConvexError(meetError);
    await recordChange(ctx, { event, principal, kind: "event_updated", summary: name !== event.name ? `renamed the event to ${name}` : "updated the event details" }, async () => {
      await ctx.db.patch(event._id, {
        name,
        meetUrl: args.meetUrl.trim(),
        updatedAt: Date.now(),
      });
    });
    await queueJudgingSheetSync(ctx, event);
  },
});

export const saveRoundOneJudgesArgs = v.object({
  slug: v.string(),
  judges: v.array(v.string()),
});

async function saveRoundOneJudgesOperation(
  ctx: MutationCtx,
  args: Infer<typeof saveRoundOneJudgesArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (eventType(event) !== "hackathon") {
      throw new ConvexError("Judge assignments are only available for hackathons.");
    }

    let names: string[];
    try {
      names = parseRoundOneJudges(args.judges);
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : "Invalid judge list.");
    }

    // A whole list of names: judges are matched to it by the names they have
    // now. New names are added first, so a judge taken off can be replaced by
    // one put on. See addJudgesToEvent and removeJudgeFromEvent.
    const wanted = new Set(names.map(judgeNameKey));
    const leaving = (await loadJudgeDirectory(ctx, event)).roster.filter((judge) => !wanted.has(judgeNameKey(judge.name)));
    await addJudgesToEvent(ctx, event, names, { syncSheet: false });
    const reassigned = new Set<string>();
    for (const judge of leaving) {
      const current = (await ctx.db.get(event._id))!;
      const result = await removeJudgeFromEvent(ctx, current, judge.key, { syncSheet: false, leaving: leaving.map((other) => other.key) });
      for (const id of result.reassignedSubmissionIds) reassigned.add(String(id));
    }
    await queueJudgingSheetSync(ctx, event, 0);
    await logAction(ctx, event._id, "round_one_judges_saved", actor, String(names.length));
    return { judgeCount: names.length, reassignedSubmissionCount: reassigned.size };
}

export const saveRoundOneJudges = mutation({
  args: saveRoundOneJudgesArgs,
  handler: async (ctx, args) =>
    saveRoundOneJudgesForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const changeEventTypeArgs = v.object({
  slug: v.string(),
  eventType: v.union(v.literal("demo"), v.literal("hackathon")),
  confirmReset: v.boolean(),
  // Needed when a hackathon becomes a demo night and has no link yet.
  meetUrl: v.optional(v.string()),
});

async function changeEventTypeOperation(
  ctx: MutationCtx,
  args: Infer<typeof changeEventTypeArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (event.judgingStatus !== undefined || event.submissionsClosedAt !== undefined) {
      throw new ConvexError("Event type cannot change after judging has started.");
    }
    if (eventType(event) === args.eventType) return { deletedSubmissions: 0 };
    const meetUrl = args.meetUrl?.trim() || event.meetUrl;
    const meetError = meetUrlError(args.eventType, meetUrl);
    if (meetError) throw new ConvexError(meetError);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    if (submissions.length > 0 && !args.confirmReset) {
      throw new ConvexError(
        `Changing event type will permanently delete ${submissions.length} submission${submissions.length === 1 ? "" : "s"} and uploaded files.`,
      );
    }

    await deleteSubmissionData(ctx, event, submissions);
    const now = Date.now();
    await ctx.db.patch(event._id, {
      ...blankEventState(now),
      eventType: args.eventType,
      meetUrl,
      judgingSheetId: undefined,
      judgingSheetUrl: undefined,
      judgingSheetCreatedAt: undefined,
      judgingSheetSyncRevision: undefined,
      judgingSheetSyncedRevision: undefined,
      judgingSheetSyncedAt: undefined,
      judgingSheetSyncError: undefined,
      roundOneJudges: undefined,
    });
    await logAction(ctx, event._id, "event_type_changed", actor, args.eventType);
    return { deletedSubmissions: submissions.length };
}

export const changeEventType = mutation({
  args: changeEventTypeArgs,
  handler: async (ctx, args) =>
    changeEventTypeForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const saveJudgingSheetArgs = v.object({
  slug: v.string(),
  spreadsheetId: v.string(),
  spreadsheetUrl: v.string(),
});

export async function saveJudgingSheetForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof saveJudgingSheetArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (eventType(event) !== "hackathon") {
      throw new ConvexError("Judging sheets are only available for hackathon events.");
    }

    if (event.judgingSheetId && event.judgingSheetUrl) {
      return {
        spreadsheetId: event.judgingSheetId,
        spreadsheetUrl: event.judgingSheetUrl,
        created: false,
      };
    }

    const now = Date.now();
    const revision = (event.judgingSheetSyncRevision ?? 0) + 1;
    await ctx.db.patch(event._id, {
      judgingSheetId: args.spreadsheetId,
      judgingSheetUrl: args.spreadsheetUrl,
      judgingSheetCreatedAt: now,
      judgingSheetSyncRevision: revision,
      judgingSheetSyncedRevision: 0,
      judgingSheetSyncedAt: undefined,
      judgingSheetSyncError: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.googleSheets.syncJudgingSheet, {
      eventId: event._id,
      revision,
    });
    await logAction(ctx, event._id, "judging_sheet_created", actor, args.spreadsheetId);
    return {
      spreadsheetId: args.spreadsheetId,
      spreadsheetUrl: args.spreadsheetUrl,
      created: true,
    };
}

export const saveJudgingSheet = mutation({
  args: saveJudgingSheetArgs,
  handler: async (ctx, args) =>
    saveJudgingSheetForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const requestJudgingSheetSyncArgs = v.object({ slug: v.string(), });

export async function requestJudgingSheetSyncForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof requestJudgingSheetSyncArgs>,
  principal: OrganizationPrincipal,
) {
    const { event } = await requireOwnedEvent(ctx, args.slug, principal);
    if (eventType(event) !== "hackathon" || !event.judgingSheetId) {
      throw new ConvexError("Create the judging sheet before syncing it.");
    }

    await queueJudgingSheetSync(ctx, event, 0);
}

export const requestJudgingSheetSync = mutation({
  args: requestJudgingSheetSyncArgs,
  handler: async (ctx, args) =>
    requestJudgingSheetSyncForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const backfillHackathonVideoLinks = mutation({
  args: {
    slug: v.string(),
    dryRun: v.boolean(),
    links: v.array(
      v.object({
        submissionId: v.id("submissions"),
        videoUrl: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { event, actor } = await requireEventOrganization(ctx, args.slug);
    if (eventType(event) !== "hackathon") {
      throw new ConvexError("Video-link backfills are only available for hackathon events.");
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const legacySubmissions = submissions.filter((submission) => submission.videoStorageId);
    if (args.links.length !== legacySubmissions.length) {
      throw new ConvexError(
        `Provide exactly one Drive link for each of the event's ${legacySubmissions.length} stored videos.`,
      );
    }

    const linksBySubmission = new Map<Id<"submissions">, string>();
    const driveFileIds = new Set<string>();
    for (const link of args.links) {
      if (linksBySubmission.has(link.submissionId)) {
        throw new ConvexError("Each submission may appear only once in the archive mapping.");
      }
      const archive = normalizeArchivedGoogleDriveVideo(link.videoUrl);
      if (!archive) {
        throw new ConvexError("Every archive URL must be a valid Google Drive file link.");
      }
      if (driveFileIds.has(archive.fileId)) {
        throw new ConvexError("Each submission must map to a different Google Drive file.");
      }
      driveFileIds.add(archive.fileId);
      linksBySubmission.set(link.submissionId, archive.videoUrl);
    }

    let alreadyBackfilled = 0;
    for (const submission of legacySubmissions) {
      const videoUrl = linksBySubmission.get(submission._id);
      if (!videoUrl) {
        throw new ConvexError(`Missing archive link for submission ${submission._id}.`);
      }
      if (submission.videoUrl && submission.videoUrl !== videoUrl) {
        throw new ConvexError(`Submission ${submission._id} already has a different video link.`);
      }
      if (submission.videoUrl === videoUrl) alreadyBackfilled += 1;
    }

    if (args.dryRun) {
      return {
        storedVideoCount: legacySubmissions.length,
        alreadyBackfilled,
        backfilled: 0,
        judgingSheetRevision: null,
      };
    }

    const now = Date.now();
    for (const submission of legacySubmissions) {
      await ctx.db.patch(submission._id, {
        videoUrl: linksBySubmission.get(submission._id)!,
        updatedAt: now,
      });
    }

    const judgingSheetRevision = await queueJudgingSheetSync(ctx, event, 0);
    if (legacySubmissions.length > 0) {
      await logAction(
        ctx,
        event._id,
        "hackathon_video_links_backfilled",
        actor,
        `${legacySubmissions.length} Drive links backfilled`,
      );
    }

    return {
      storedVideoCount: legacySubmissions.length,
      alreadyBackfilled,
      backfilled: legacySubmissions.length - alreadyBackfilled,
      judgingSheetRevision,
    };
  },
});

export const deleteBackfilledHackathonVideoUploads = mutation({
  args: {
    slug: v.string(),
    dryRun: v.boolean(),
    submissionIds: v.array(v.id("submissions")),
    judgingSheetRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const { event, actor } = await requireEventOrganization(ctx, args.slug);
    if (eventType(event) !== "hackathon") {
      throw new ConvexError("Video archival is only available for hackathon events.");
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const submissionsById = new Map(submissions.map((submission) => [submission._id, submission]));
    const requestedIds = new Set(args.submissionIds);
    if (requestedIds.size !== args.submissionIds.length) {
      throw new ConvexError("Each submission may appear only once in the deletion request.");
    }

    const driveFileIds = new Set<string>();
    for (const submissionId of requestedIds) {
      const submission = submissionsById.get(submissionId);
      if (!submission) {
        throw new ConvexError(`Submission ${submissionId} does not belong to this event.`);
      }
      const archive = submission.videoUrl
        ? normalizeArchivedGoogleDriveVideo(submission.videoUrl)
        : null;
      if (!archive) {
        throw new ConvexError(`Submission ${submissionId} does not have a Drive archive link.`);
      }
      if (driveFileIds.has(archive.fileId)) {
        throw new ConvexError("Each submission must map to a different Google Drive file.");
      }
      driveFileIds.add(archive.fileId);
    }

    const storedSubmissions = submissions.filter((submission) => submission.videoStorageId);
    for (const submission of storedSubmissions) {
      if (!requestedIds.has(submission._id)) {
        throw new ConvexError(`Stored video ${submission._id} is missing from the deletion request.`);
      }
    }

    const latestRevision = event.judgingSheetSyncRevision ?? 0;
    const syncedRevision = event.judgingSheetSyncedRevision ?? 0;
    if (
      !event.judgingSheetId ||
      event.judgingSheetSyncError ||
      latestRevision < args.judgingSheetRevision ||
      syncedRevision !== latestRevision
    ) {
      throw new ConvexError("Wait for the latest judging sheet sync before deleting stored videos.");
    }

    if (args.dryRun) {
      return { storedVideoCount: storedSubmissions.length, deleted: 0 };
    }

    const now = Date.now();
    for (const submission of storedSubmissions) {
      await ctx.storage.delete(submission.videoStorageId!);
      await ctx.db.patch(submission._id, {
        videoStorageId: undefined,
        videoDeleteAt: undefined,
        videoDeletedAt: now,
        updatedAt: now,
      });
    }
    if (storedSubmissions.length > 0) {
      await logAction(
        ctx,
        event._id,
        "hackathon_video_uploads_deleted",
        actor,
        `${storedSubmissions.length} backfilled stored copies deleted`,
      );
    }

    return { storedVideoCount: 0, deleted: storedSubmissions.length };
  },
});

export const getJudgingSheetSyncSnapshot = internalQuery({
  args: { eventId: v.id("events"), revision: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (
      !event ||
      eventType(event) !== "hackathon" ||
      !event.judgingSheetId ||
      event.judgingSheetSyncRevision !== args.revision
    ) {
      return null;
    }

    const [submissions, teamMembers] = await Promise.all([
      ctx.db
        .query("submissions")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect(),
      ctx.db
        .query("teamMembers")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect(),
    ]);
    const byId = tracksById(await listEventTracks(ctx, event._id));
    const judges = await loadJudgeDirectory(ctx, event);
    const membersBySubmission = new Map<string, string[]>();
    for (const member of teamMembers) {
      const members = membersBySubmission.get(member.submissionId) ?? [];
      members.push(member.name);
      membersBySubmission.set(member.submissionId, members);
    }

    const sheetSubmissions = await Promise.all(
      submissions
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async (submission) => ({
          id: submission._id,
          teamName: submission.teamName,
          teamMembers: membersBySubmission.get(submission._id) ?? [],
          name: submission.name,
          demoTitle: submission.demoTitle,
          description: submission.description,
          tracks: trackNamesFor(submission, byId),
          githubUrl: submission.githubUrl,
          roundOneAssignedJudges: submission.roundOneAssignedJudges?.map(judges.nameOf),
          roundOneAssignedJudgeKeys: submission.roundOneAssignedJudges?.map(judgeKeyOf),
          videoUrl: await resolveSubmissionVideoUrl(ctx, submission),
          email: submission.email,
          phone: submission.phone,
          twitter: submission.twitter,
          linkedin: submission.linkedin,
          status: submission.status,
          createdAt: submission.createdAt,
        })),
    );

    return {
      eventId: event._id,
      eventName: event.name,
      meetUrl: event.meetUrl,
      spreadsheetId: event.judgingSheetId,
      revision: args.revision,
      submissions: sheetSubmissions,
      // Every judge's key and name now, to match the sheet's judge cells.
      judges: judges.judges.map((judge) => ({ key: judge.key, name: judge.name })),
    };
  },
});

export const completeJudgingSheetSync = internalMutation({
  args: {
    eventId: v.id("events"),
    revision: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    if (event.judgingSheetSyncRevision !== args.revision) {
      if (event.judgingSheetSyncRevision !== undefined) {
        await ctx.scheduler.runAfter(0, internal.googleSheets.syncJudgingSheet, {
          eventId: event._id,
          revision: event.judgingSheetSyncRevision,
        });
      }
      return;
    }

    if (args.error) {
      await ctx.db.patch(event._id, { judgingSheetSyncError: args.error });
      return;
    }

    await ctx.db.patch(event._id, {
      judgingSheetSyncedRevision: args.revision,
      judgingSheetSyncedAt: Date.now(),
      judgingSheetSyncError: undefined,
    });
  },
});

export const updateSubmissionArgs = v.object({
  slug: v.string(),
  submissionId: v.id("submissions"),
  name: v.string(),
  demoTitle: v.string(),
  description: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  twitter: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  githubProfile: v.optional(v.string()),
  category: v.optional(v.string()),
  trackIds: v.optional(v.array(v.id("eventTracks"))),
});

async function updateSubmissionOperation(
  ctx: MutationCtx,
  args: Infer<typeof updateSubmissionArgs>,
  principal: OrganizationPrincipal,
) {
    const { event } = await requireOwnedEvent(ctx, args.slug, principal);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    const { category, githubProfile, ...fields } = normalizeSubmissionTextFields(args);
    const email = await emailFields(ctx, event._id, fields.email, {
      ownSubmissionId: submission._id,
      holds: holdsEmails(submission.status),
    });
    const { patch: socialPatch, emailChanged } = socialEditPatch(
      submission,
      { twitter: fields.twitter, linkedin: fields.linkedin, ...(args.githubProfile !== undefined ? { githubProfile } : {}) },
      fields.email,
    );
    await ctx.db.patch(args.submissionId, {
      ...fields,
      ...email,
      ...socialPatch,
      // Legacy clients still send a category; newer ones send tracks instead.
      ...(args.category !== undefined ? { category } : {}),
      ...(await trackSelection(ctx, event, args.trackIds)),
      updatedAt: Date.now(),
    });
    // A changed description gets a new AI summary once submissions are closed.
    const updated = await ctx.db.get(args.submissionId);
    if (updated) await queueAiSummaryIfStale(ctx, event, updated, 0, { source: "organiser" });
    await queueJudgingSheetSync(ctx, event);
    if (emailChanged && event.submissionsClosedAt === undefined) await queueLumaImport(ctx, event, args.submissionId);
}

export const updateSubmission = mutation({
  args: updateSubmissionArgs,
  handler: async (ctx, args) =>
    updateSubmissionForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const publishQueueArgs = v.object({ slug: v.string(), });

async function publishQueueOperation(
  ctx: MutationCtx,
  args: Infer<typeof publishQueueArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    await ctx.db.patch(event._id, {
      queuePublished: true,
      stageScreenMode: "demo",
      // A demo night's Stage is its published lineup, as setPhase does it.
      ...(event.eventType !== "hackathon" && eventPhase(event) === "submissions" ? { phase: "stage" as const } : {}),
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "queue_published", actor);
}

export const publishQueue = mutation({
  args: publishQueueArgs,
  handler: async (ctx, args) =>
    publishQueueForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setStageScreenModeArgs = v.object({
  slug: v.string(),
  mode: v.union(v.literal("qr"), v.literal("demo")),
});

async function setStageScreenModeOperation(
  ctx: MutationCtx,
  args: Infer<typeof setStageScreenModeArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    await ctx.db.patch(event._id, {
      stageScreenMode: args.mode,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, `stage_screen_${args.mode}`, actor);
}

export const setStageScreenMode = mutation({
  args: setStageScreenModeArgs,
  handler: async (ctx, args) =>
    setStageScreenModeForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setSubmissionCountVisibleArgs = v.object({
  slug: v.string(),
  visible: v.boolean(),
});

async function setSubmissionCountVisibleOperation(
  ctx: MutationCtx,
  args: Infer<typeof setSubmissionCountVisibleArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    await ctx.db.patch(event._id, {
      showSubmissionCountOnStage: args.visible,
      updatedAt: Date.now(),
    });
    await logAction(
      ctx,
      event._id,
      args.visible ? "stage_submission_count_visible" : "stage_submission_count_hidden",
      actor,
    );
}

export const setSubmissionCountVisible = mutation({
  args: setSubmissionCountVisibleArgs,
  handler: async (ctx, args) =>
    setSubmissionCountVisibleForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setStageMeetLinkVisibleArgs = v.object({
  slug: v.string(),
  visible: v.boolean(),
});

async function setStageMeetLinkVisibleOperation(
  ctx: MutationCtx,
  args: Infer<typeof setStageMeetLinkVisibleArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    if (args.visible && !event.queuePublished) {
      throw new ConvexError("Publish the queue before showing the Meet link in the presentation view");
    }

    await ctx.db.patch(event._id, {
      showMeetLinkOnStage: args.visible,
      updatedAt: Date.now(),
    });
    await logAction(
      ctx,
      event._id,
      args.visible ? "stage_meet_link_enabled" : "stage_meet_link_disabled",
      actor,
    );
}

export const setStageMeetLinkVisible = mutation({
  args: setStageMeetLinkVisibleArgs,
  handler: async (ctx, args) =>
    setStageMeetLinkVisibleForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setStageTimerVisibleArgs = v.object({
  slug: v.string(),
  visible: v.boolean(),
});

async function setStageTimerVisibleOperation(
  ctx: MutationCtx,
  args: Infer<typeof setStageTimerVisibleArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    await ctx.db.patch(event._id, {
      showStageTimerOnStage: args.visible,
      updatedAt: Date.now(),
    });
    await logAction(
      ctx,
      event._id,
      args.visible ? "stage_timer_visible" : "stage_timer_hidden",
      actor,
    );
}

export const setStageTimerVisible = mutation({
  args: setStageTimerVisibleArgs,
  handler: async (ctx, args) =>
    setStageTimerVisibleForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setStageResultsShowFinalistsArgs = v.object({
  slug: v.string(),
  showFinalists: v.boolean(),
});

async function setStageResultsShowFinalistsOperation(
  ctx: MutationCtx,
  args: Infer<typeof setStageResultsShowFinalistsArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    await ctx.db.patch(event._id, {
      stageResultsShowFinalists: args.showFinalists,
      updatedAt: Date.now(),
    });
    await logAction(
      ctx,
      event._id,
      args.showFinalists ? "stage_results_finalists_shown" : "stage_results_winners_only",
      actor,
    );
}

export const setStageResultsShowFinalists = mutation({
  args: setStageResultsShowFinalistsArgs,
  handler: async (ctx, args) =>
    setStageResultsShowFinalistsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setStageTimerDurationArgs = v.object({
  slug: v.string(),
  durationMs: v.number(),
});

async function setStageTimerDurationOperation(
  ctx: MutationCtx,
  args: Infer<typeof setStageTimerDurationArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const previousDurationMs = stageTimerDuration(event);
    const previousRemainingMs = currentStageTimerRemaining(event, now);
    const elapsedMs = previousDurationMs - previousRemainingMs;
    const durationMs = clampTimerDurationMs(args.durationMs);
    const patch: Partial<Doc<"events">> = {
      stageTimerDurationMs: durationMs,
      updatedAt: now,
    };

    if ((event.stageTimerStatus ?? "idle") === "running") {
      const nextRemainingMs = clampSignedTimerMs(durationMs - elapsedMs);
      patch.stageTimerRemainingMs = nextRemainingMs;
      patch.stageTimerEndsAt = now + nextRemainingMs;
    } else {
      patch.stageTimerRemainingMs = durationMs;
      patch.stageTimerEndsAt = undefined;
    }

    await ctx.db.patch(event._id, patch);
    await logAction(ctx, event._id, "stage_timer_duration_set", actor, String(durationMs));
}

export const setStageTimerDuration = mutation({
  args: setStageTimerDurationArgs,
  handler: async (ctx, args) =>
    setStageTimerDurationForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setStageTimerRemainingArgs = v.object({
  slug: v.string(),
  remainingMs: v.number(),
});

/**
 * Sets exactly how long the stage timer has left, for "click the time and
 * type it" and the presets. Running or paused, it keeps its state; idle, it
 * becomes the next run's length.
 */
async function setStageTimerRemainingOperation(
  ctx: MutationCtx,
  args: Infer<typeof setStageTimerRemainingArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (!Number.isFinite(args.remainingMs)) throw new ConvexError("Enter a time.");
    const now = Date.now();
    const remainingMs = clampTimerMs(Math.round(args.remainingMs / 1000) * 1000);
    const status = event.stageTimerStatus ?? "idle";
    await ctx.db.patch(event._id, {
      stageTimerRemainingMs: remainingMs,
      ...(status === "running" ? { stageTimerEndsAt: now + remainingMs } : {}),
      ...(status === "idle" || stageTimerDuration(event) < remainingMs ? { stageTimerDurationMs: clampTimerDurationMs(remainingMs) } : {}),
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_remaining_set", actor, String(remainingMs));
    return { remainingMs };
}

export const setStageTimerRemaining = mutation({
  args: setStageTimerRemainingArgs,
  handler: async (ctx, args) =>
    setStageTimerRemainingForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const startStageTimerArgs = v.object({
  slug: v.string(),
  durationMs: v.optional(v.number()),
});

async function startStageTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof startStageTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const durationMs = clampTimerDurationMs(args.durationMs ?? stageTimerDuration(event));
    const currentRemainingMs = currentStageTimerRemaining(event, now);
    const remainingMs =
      event.stageTimerStatus === "paused" && currentRemainingMs > 0
        ? currentRemainingMs
        : durationMs;

    await ctx.db.patch(event._id, {
      showStageTimerOnStage: true,
      stageTimerStatus: "running",
      stageTimerDurationMs: durationMs,
      stageTimerRemainingMs: remainingMs,
      stageTimerEndsAt: now + remainingMs,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_started", actor, String(remainingMs));
}

export const startStageTimer = mutation({
  args: startStageTimerArgs,
  handler: async (ctx, args) =>
    startStageTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setDemoTimerVisibleArgs = v.object({
  slug: v.string(),
  visible: v.boolean(),
});

async function setDemoTimerVisibleOperation(
  ctx: MutationCtx,
  args: Infer<typeof setDemoTimerVisibleArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const patch: Partial<Doc<"events">> = {
      showDemoTimerOnStage: args.visible,
      updatedAt: now,
    };

    if (args.visible && event.demoTimerStatus === undefined) {
      const durationMs = demoTimerDuration(event);
      patch.demoTimerStatus = "idle";
      patch.demoTimerDurationMs = durationMs;
      patch.demoTimerRemainingMs = durationMs;
      patch.demoTimerEndsAt = undefined;
    }

    await ctx.db.patch(event._id, patch);
    await logAction(
      ctx,
      event._id,
      args.visible ? "demo_timer_visible" : "demo_timer_hidden",
      actor,
    );
}

export const setDemoTimerVisible = mutation({
  args: setDemoTimerVisibleArgs,
  handler: async (ctx, args) =>
    setDemoTimerVisibleForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setDemoTimerDurationArgs = v.object({
  slug: v.string(),
  durationMs: v.number(),
});

async function setDemoTimerDurationOperation(
  ctx: MutationCtx,
  args: Infer<typeof setDemoTimerDurationArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const durationMs = clampTimerDurationMs(args.durationMs);
    const patch: Partial<Doc<"events">> = {
      demoTimerDurationMs: durationMs,
      updatedAt: Date.now(),
    };

    if ((event.demoTimerStatus ?? "idle") === "idle") {
      patch.demoTimerRemainingMs = durationMs;
      patch.demoTimerEndsAt = undefined;
    }

    await ctx.db.patch(event._id, patch);
    await logAction(ctx, event._id, "demo_timer_duration_set", actor, String(durationMs));
}

export const setDemoTimerDuration = mutation({
  args: setDemoTimerDurationArgs,
  handler: async (ctx, args) =>
    setDemoTimerDurationForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const startDemoTimerArgs = v.object({
  slug: v.string(),
  });

async function startDemoTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof startDemoTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const durationMs = demoTimerDuration(event);
    const currentRemainingMs = currentDemoTimerRemaining(event, now);
    const remainingMs =
      event.demoTimerStatus === "paused" ? currentRemainingMs : durationMs;

    await ctx.db.patch(event._id, {
      showDemoTimerOnStage: true,
      demoTimerStatus: "running",
      demoTimerDurationMs: durationMs,
      demoTimerRemainingMs: remainingMs,
      demoTimerEndsAt: now + remainingMs,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "demo_timer_started", actor, String(remainingMs));
}

export const startDemoTimer = mutation({
  args: startDemoTimerArgs,
  handler: async (ctx, args) =>
    startDemoTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const pauseDemoTimerArgs = v.object({
  slug: v.string(),
  });

async function pauseDemoTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof pauseDemoTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const remainingMs = currentDemoTimerRemaining(event, now);

    await ctx.db.patch(event._id, {
      demoTimerStatus: "paused",
      demoTimerRemainingMs: remainingMs,
      demoTimerEndsAt: undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "demo_timer_paused", actor, String(remainingMs));
}

export const pauseDemoTimer = mutation({
  args: pauseDemoTimerArgs,
  handler: async (ctx, args) =>
    pauseDemoTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const adjustDemoTimerArgs = v.object({
  slug: v.string(),
  deltaMs: v.number(),
});

async function adjustDemoTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof adjustDemoTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const isRunning = event.demoTimerStatus === "running";
    const nextRemainingMs = currentDemoTimerRemaining(event, now) + args.deltaMs;
    const remainingMs =
      isRunning || event.demoTimerStatus === "paused"
        ? clampSignedTimerMs(nextRemainingMs)
        : clampTimerMs(nextRemainingMs);

    await ctx.db.patch(event._id, {
      demoTimerStatus: isRunning ? "running" : event.demoTimerStatus ?? "idle",
      demoTimerRemainingMs: remainingMs,
      demoTimerEndsAt: isRunning ? now + remainingMs : undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "demo_timer_adjusted", actor, String(args.deltaMs));
}

export const adjustDemoTimer = mutation({
  args: adjustDemoTimerArgs,
  handler: async (ctx, args) =>
    adjustDemoTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const pauseStageTimerArgs = v.object({
  slug: v.string(),
  });

async function pauseStageTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof pauseStageTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const remainingMs = currentStageTimerRemaining(event, now);

    await ctx.db.patch(event._id, {
      stageTimerStatus: "paused",
      stageTimerRemainingMs: remainingMs,
      stageTimerEndsAt: undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_paused", actor, String(remainingMs));
}

export const pauseStageTimer = mutation({
  args: pauseStageTimerArgs,
  handler: async (ctx, args) =>
    pauseStageTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const resetStageTimerArgs = v.object({
  slug: v.string(),
  durationMs: v.optional(v.number()),
});

async function resetStageTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof resetStageTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const durationMs = clampTimerDurationMs(args.durationMs ?? stageTimerDuration(event));

    await ctx.db.patch(event._id, {
      showStageTimerOnStage: false,
      stageTimerStatus: "idle",
      stageTimerDurationMs: durationMs,
      stageTimerRemainingMs: durationMs,
      stageTimerEndsAt: undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_reset", actor, String(durationMs));
}

export const resetStageTimer = mutation({
  args: resetStageTimerArgs,
  handler: async (ctx, args) =>
    resetStageTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const adjustStageTimerArgs = v.object({
  slug: v.string(),
  deltaMs: v.number(),
});

async function adjustStageTimerOperation(
  ctx: MutationCtx,
  args: Infer<typeof adjustStageTimerArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const now = Date.now();
    const isRunning = event.stageTimerStatus === "running";
    const nextRemainingMs = currentStageTimerRemaining(event, now) + args.deltaMs;
    const remainingMs = isRunning ? clampSignedTimerMs(nextRemainingMs) : clampTimerMs(nextRemainingMs);

    await ctx.db.patch(event._id, {
      stageTimerStatus: isRunning ? "running" : event.stageTimerStatus ?? "idle",
      stageTimerRemainingMs: remainingMs,
      stageTimerEndsAt: isRunning ? now + remainingMs : undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_adjusted", actor, String(args.deltaMs));
}

export const adjustStageTimer = mutation({
  args: adjustStageTimerArgs,
  handler: async (ctx, args) =>
    adjustStageTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const hideSubmissionArgs = v.object({
  slug: v.string(),
  submissionId: v.id("submissions"),
});

async function hideSubmissionOperation(
  ctx: MutationCtx,
  args: Infer<typeof hideSubmissionArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    const now = Date.now();
    await patchSubmissionStatus(ctx, submission, {
      status: "hidden",
      queueOrder: undefined,
      updatedAt: now,
    });
    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "submission_hidden", actor, args.submissionId);
    await queueJudgingSheetSync(ctx, event);
}

export const hideSubmission = mutation({
  args: hideSubmissionArgs,
  handler: async (ctx, args) =>
    hideSubmissionForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const restoreSubmissionArgs = v.object({
  slug: v.string(),
  submissionId: v.id("submissions"),
});

async function restoreSubmissionOperation(
  ctx: MutationCtx,
  args: Infer<typeof restoreSubmissionArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    const now = Date.now();
    // Restoring a hidden person returns them to the pool, not straight into the
    // lineup; the admin drags them into the running order if they want them.
    await patchSubmissionStatus(ctx, submission, {
      status: "candidate",
      queueOrder: undefined,
      updatedAt: now,
    });
    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "submission_restored", actor, args.submissionId);
    await queueJudgingSheetSync(ctx, event);
}

export const restoreSubmission = mutation({
  args: restoreSubmissionArgs,
  handler: async (ctx, args) =>
    restoreSubmissionForOrganization(ctx, args, await requireOrganization(ctx)),
});

// Reorders the lineup AND pulls in any pool/hidden person whose id appears in
// orderedIds (used for both intra-lineup drag and pool -> lineup drops). Every
// listed id becomes "queued" with queueOrder set to its position.
export const reorderLineupArgs = v.object({
  slug: v.string(),
  orderedIds: v.array(v.id("submissions")),
});

async function reorderLineupOperation(
  ctx: MutationCtx,
  args: Infer<typeof reorderLineupArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    const now = Date.now();
    for (const [index, submissionId] of args.orderedIds.entries()) {
      const submission = await ctx.db.get(submissionId);
      if (
        !submission ||
        submission.eventId !== event._id ||
        ["done", "no_show", "withdrawn"].includes(submission.status)
      ) {
        continue;
      }
      await patchSubmissionStatus(ctx, submission, {
        status: "queued",
        queueOrder: index + 1,
        updatedAt: now,
      });
    }

    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "lineup_reordered", actor);
    await queueJudgingSheetSync(ctx, event);
}

export const reorderLineup = mutation({
  args: reorderLineupArgs,
  handler: async (ctx, args) =>
    reorderLineupForOrganization(ctx, args, await requireOrganization(ctx)),
});

// Repopulate the lineup with a random draw from everyone currently in the lineup
// or the pool, honoring the lineup target. Everyone not drawn goes to the pool.
export const shuffleLineupArgs = v.object({ slug: v.string(), });

async function shuffleLineupOperation(
  ctx: MutationCtx,
  args: Infer<typeof shuffleLineupArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const eligible = submissions.filter(
      (s) => s.status === "queued" || s.status === "candidate",
    );

    // Fisher-Yates. Convex seeds Math.random per mutation, so retries are stable.
    for (let i = eligible.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }

    const target =
      event.lineupTarget && event.lineupTarget > 0
        ? Math.min(event.lineupTarget, eligible.length)
        : eligible.length;

    const now = Date.now();
    for (let i = 0; i < eligible.length; i += 1) {
      const inLineup = i < target;
      await patchSubmissionStatus(ctx, eligible[i], {
        status: inLineup ? "queued" : "candidate",
        queueOrder: inLineup ? i + 1 : undefined,
        updatedAt: now,
      });
    }

    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "lineup_shuffled", actor);
    await queueJudgingSheetSync(ctx, event);
}

export const shuffleLineup = mutation({
  args: shuffleLineupArgs,
  handler: async (ctx, args) =>
    shuffleLineupForOrganization(ctx, args, await requireOrganization(ctx)),
});

// Apply an explicit lineup order (e.g. from the AI shuffle): the given ids
// become the lineup in that order; every other eligible person goes to the pool.
export const setLineupOrderArgs = v.object({
  slug: v.string(),
  orderedIds: v.array(v.id("submissions")),
});

async function setLineupOrderOperation(
  ctx: MutationCtx,
  args: Infer<typeof setLineupOrderArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const eligible = new Map(
      submissions
        .filter((s) => s.status === "queued" || s.status === "candidate")
        .map((s) => [s._id, s]),
    );
    const eligibleIds = new Set(eligible.keys());

    const now = Date.now();
    const placed = new Set<string>();
    let order = 1;
    for (const id of args.orderedIds) {
      if (!eligibleIds.has(id) || placed.has(id)) continue;
      await patchSubmissionStatus(ctx, eligible.get(id)!, { status: "queued", queueOrder: order, updatedAt: now });
      placed.add(id);
      order += 1;
    }
    for (const id of eligibleIds) {
      if (!placed.has(id)) {
        await patchSubmissionStatus(ctx, eligible.get(id)!, { status: "candidate", queueOrder: undefined, updatedAt: now });
      }
    }

    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "lineup_ai_ordered", actor);
    await queueJudgingSheetSync(ctx, event);
}

export const setLineupOrder = mutation({
  args: setLineupOrderArgs,
  handler: async (ctx, args) =>
    setLineupOrderForOrganization(ctx, args, await requireOrganization(ctx)),
});

// Pulls a person out of the lineup back into the pool ("all people").
export const moveToPoolArgs = v.object({
  slug: v.string(),
  submissionId: v.id("submissions"),
});

async function moveToPoolOperation(
  ctx: MutationCtx,
  args: Infer<typeof moveToPoolArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    const now = Date.now();
    await patchSubmissionStatus(ctx, submission, {
      status: "candidate",
      queueOrder: undefined,
      updatedAt: now,
    });
    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "submission_to_pool", actor, args.submissionId);
    await queueJudgingSheetSync(ctx, event);
}

export const moveToPool = mutation({
  args: moveToPoolArgs,
  handler: async (ctx, args) =>
    moveToPoolForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setLineupTargetArgs = v.object({
  slug: v.string(),
  target: v.number(),
});

async function setLineupTargetOperation(
  ctx: MutationCtx,
  args: Infer<typeof setLineupTargetArgs>,
  principal: OrganizationPrincipal,
) {
    const { event } = await requireOwnedEvent(ctx, args.slug, principal);

    const clamped = Math.max(0, Math.min(99, Math.round(args.target)));
    await ctx.db.patch(event._id, { lineupTarget: clamped, updatedAt: Date.now() });
}

export const setLineupTarget = mutation({
  args: setLineupTargetArgs,
  handler: async (ctx, args) =>
    setLineupTargetForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const markNoShowArgs = v.object({
  slug: v.string(),
  expectedCurrentId: v.optional(v.string()),
  });

async function markNoShowOperation(
  ctx: MutationCtx,
  args: Infer<typeof markNoShowArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (!event.queuePublished) {
      return;
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const current = lineupSorted(submissions)[0];
    if (!current || (args.expectedCurrentId !== undefined && String(current._id) !== args.expectedCurrentId)) {
      return;
    }

    const now = Date.now();
    await patchSubmissionStatus(ctx, current, {
      status: "no_show",
      queueOrder: undefined,
      updatedAt: now,
    });
    await clearAdvanceSnapshot(ctx, event, now);
    await logAction(ctx, event._id, "submission_no_show", actor, current._id);
    await queueJudgingSheetSync(ctx, event);
}

export const markNoShow = mutation({
  args: markNoShowArgs,
  handler: async (ctx, args) =>
    markNoShowForOrganization(ctx, args, await requireOrganization(ctx)),
});

// Advance the show: the person at the top of the lineup (current) is marked
// done, so the next person becomes position 0. Order is positional, so nothing
// else needs to move.
// expectedCurrentId: the presenter the organiser saw. A second click, or a
// second organiser, that arrives after the show moved on does nothing.
export const pickNextArgs = v.object({ slug: v.string(), expectedCurrentId: v.optional(v.string()) });

async function pickNextOperation(
  ctx: MutationCtx,
  args: Infer<typeof pickNextArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (!event.queuePublished) {
      return;
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const lineup = lineupSorted(submissions);
    const current = lineup[0];
    if (!current || (args.expectedCurrentId !== undefined && String(current._id) !== args.expectedCurrentId)) {
      return;
    }

    const now = Date.now();
    const demoDurationMs = demoTimerDuration(event);
    const demoRemainingMs = currentDemoTimerRemaining(event, now);
    const demoTimerStatus = event.demoTimerStatus ?? "idle";

    await patchSubmissionStatus(ctx, current, {
      status: "done",
      queueOrder: undefined,
      updatedAt: now,
    });

    await ctx.db.patch(event._id, {
      lastAdvanceSnapshot: {
        createdAt: now,
        currentSubmissionId: current._id,
        currentQueueOrder: current.queueOrder,
        demoTimerStatus,
        demoTimerDurationMs: demoDurationMs,
        demoTimerRemainingMs: demoRemainingMs,
      },
      demoTimerStatus: "idle",
      demoTimerDurationMs: demoDurationMs,
      demoTimerRemainingMs: demoDurationMs,
      demoTimerEndsAt: undefined,
      updatedAt: now,
    });

    await logAction(ctx, event._id, "pick_next", actor);
    await queueJudgingSheetSync(ctx, event);
}

export const pickNext = mutation({
  args: pickNextArgs,
  handler: async (ctx, args) =>
    pickNextForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const restorePreviousPresenterArgs = v.object({ slug: v.string(), });

async function restorePreviousPresenterOperation(
  ctx: MutationCtx,
  args: Infer<typeof restorePreviousPresenterArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    const snapshot = event.lastAdvanceSnapshot;
    if (!snapshot) {
      return;
    }

    const submission = await ctx.db.get(snapshot.currentSubmissionId);
    if (!submission || submission.eventId !== event._id) {
      await ctx.db.patch(event._id, { lastAdvanceSnapshot: undefined, updatedAt: Date.now() });
      return;
    }

    const now = Date.now();
    const restoredStatus = snapshot.demoTimerStatus === "idle" ? "idle" : "paused";
    const restoredRemainingMs =
      restoredStatus === "idle"
        ? snapshot.demoTimerDurationMs
        : clampSignedTimerMs(snapshot.demoTimerRemainingMs);

    await patchSubmissionStatus(ctx, submission, {
      status: "queued",
      queueOrder: snapshot.currentQueueOrder ?? now,
      updatedAt: now,
    });

    await ctx.db.patch(event._id, {
      lastAdvanceSnapshot: undefined,
      demoTimerStatus: restoredStatus,
      demoTimerDurationMs: snapshot.demoTimerDurationMs,
      demoTimerRemainingMs: restoredRemainingMs,
      demoTimerEndsAt: undefined,
      updatedAt: now,
    });

    await logAction(ctx, event._id, "previous_presenter_restored", actor, snapshot.currentSubmissionId);
    await queueJudgingSheetSync(ctx, event);
}

export const restorePreviousPresenter = mutation({
  args: restorePreviousPresenterArgs,
  handler: async (ctx, args) =>
    restorePreviousPresenterForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const skipCurrentArgs = v.object({ slug: v.string(), });

async function skipCurrentOperation(
  ctx: MutationCtx,
  args: Infer<typeof skipCurrentArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);
    if (!event.queuePublished) {
      return;
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const lineup = lineupSorted(submissions);
    const current = lineup[0];
    if (!current || lineup.length < 2) {
      return;
    }

    const lastQueueOrder = lineup.reduce(
      (max, submission) => Math.max(max, submission.queueOrder ?? 0),
      0,
    );

    const now = Date.now();
    await ctx.db.patch(current._id, {
      queueOrder: lastQueueOrder + 1,
      updatedAt: now,
    });
    // The next presenter starts on a fresh demo timer, as after Advance and No-show.
    const demoDurationMs = demoTimerDuration(event);
    await ctx.db.patch(event._id, {
      lastAdvanceSnapshot: undefined,
      demoTimerStatus: "idle",
      demoTimerDurationMs: demoDurationMs,
      demoTimerRemainingMs: demoDurationMs,
      demoTimerEndsAt: undefined,
      updatedAt: now,
    });

    await logAction(ctx, event._id, "current_skipped", actor, current._id);
    await queueJudgingSheetSync(ctx, event);
}

export const skipCurrent = mutation({
  args: skipCurrentArgs,
  handler: async (ctx, args) =>
    skipCurrentForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const clearQueueArgs = v.object({ slug: v.string(), });

async function clearQueueOperation(
  ctx: MutationCtx,
  args: Infer<typeof clearQueueArgs>,
  principal: OrganizationPrincipal,
) {
    const { event, actor } = await requireOwnedEvent(ctx, args.slug, principal);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    // Permanently remove every submission, team member, and uploaded file,
    // returning the event to its blank, pre-publish state.
    await deleteSubmissionData(ctx, event, submissions);

    await ctx.db.patch(event._id, {
      ...blankEventState(Date.now()),
      judgingSheetId: undefined,
      judgingSheetUrl: undefined,
      judgingSheetCreatedAt: undefined,
      judgingSheetSyncRevision: undefined,
      judgingSheetSyncedRevision: undefined,
      judgingSheetSyncedAt: undefined,
      judgingSheetSyncError: undefined,
    });
    await logAction(ctx, event._id, "queue_cleared", actor);
}

export const clearQueue = mutation({
  args: clearQueueArgs,
  handler: async (ctx, args) =>
    clearQueueForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const deleteExpiredHackathonVideos = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const now = Date.now();
    const expired = await ctx.db
      .query("submissions")
      .withIndex("by_video_delete_at", (q) =>
        q.gt("videoDeleteAt", 0).lte("videoDeleteAt", now),
      )
      .take(50);

    for (const submission of expired) {
      if (submission.videoStorageId) await ctx.storage.delete(submission.videoStorageId);
      await ctx.db.patch(submission._id, {
        videoStorageId: undefined,
        videoDeleteAt: undefined,
        videoDeletedAt: now,
        updatedAt: now,
      });
    }

    if (expired.length === 50) {
      await ctx.scheduler.runAfter(0, internal.events.deleteExpiredHackathonVideos, {});
    }
    return { deleted: expired.length };
  },
});

export const deleteOrphanedSubmissionUploads = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    cutoff: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ deleted: number; scanned: number }> => {
    const cutoff = args.cutoff ?? Date.now() - ORPHAN_UPLOAD_GRACE_MS;
    const page = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: ORPHAN_UPLOAD_BATCH_SIZE });
    let deleted = 0;
    let scanned = 0;
    let reachedGracePeriod = false;

    for (const file of page.page) {
      if (file._creationTime > cutoff) {
        reachedGracePeriod = true;
        break;
      }
      scanned += 1;
      const [screenshotSubmission, videoSubmission] = await Promise.all([
        ctx.db
          .query("submissions")
          .withIndex("by_screenshot_id", (q) => q.eq("screenshotId", file._id))
          .first(),
        ctx.db
          .query("submissions")
          .withIndex("by_video_storage_id", (q) => q.eq("videoStorageId", file._id))
          .first(),
      ]);
      if (!screenshotSubmission && !videoSubmission) {
        await ctx.storage.delete(file._id);
        deleted += 1;
      }
    }

    if (!reachedGracePeriod && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.events.deleteOrphanedSubmissionUploads, {
        cursor: page.continueCursor,
        cutoff,
      });
    }

    return { deleted, scanned };
  },
});

// Organiser operations, recorded for Recent changes and Undo (convex/changeLog.ts).
export const adminAddSubmissionForOrganization = withChange<Infer<typeof adminAddSubmissionArgs>, Awaited<ReturnType<typeof adminAddSubmissionOperation>>>(
  (_ctx, args) => ({ kind: "submission_added", summary: `added ${args.demoTitle.trim() || args.name.trim()}`, watch: { submissions: "all" } }),
  adminAddSubmissionOperation,
);

export const adminAddTestSubmissionsForOrganization = withChange<Infer<typeof adminAddTestSubmissionsArgs>, Awaited<ReturnType<typeof adminAddTestSubmissionsOperation>>>(
  (_ctx, args) => ({ kind: "test_submissions_added", summary: `added ${args.submissions.length} test submission${args.submissions.length === 1 ? "" : "s"}`, watch: { submissions: "all", teamMembers: "all" } }),
  adminAddTestSubmissionsOperation,
);

export const saveRoundOneJudgesForOrganization = withChange<Infer<typeof saveRoundOneJudgesArgs>, Awaited<ReturnType<typeof saveRoundOneJudgesOperation>>>(
  () => ({ kind: "judges_saved", summary: "updated the judges", watch: { submissions: "all", judgeAccess: "all" } }),
  saveRoundOneJudgesOperation,
);

export const changeEventTypeForOrganization = withChange<Infer<typeof changeEventTypeArgs>, Awaited<ReturnType<typeof changeEventTypeOperation>>>(
  (_ctx, args) => ({ kind: "event_type_changed", summary: `changed the event to a ${args.eventType === "hackathon" ? "hackathon" : "demo night"}`, watch: { submissions: "all", teamMembers: "all" } }),
  changeEventTypeOperation,
);

export const updateSubmissionForOrganization = withChange<Infer<typeof updateSubmissionArgs>, Awaited<ReturnType<typeof updateSubmissionOperation>>>(
  async (ctx, args, event) => ({ kind: "submission_edited", summary: `edited ${await submissionTitle(ctx, event, args.submissionId)}`, subjectId: args.submissionId, watch: { submissions: [args.submissionId] } }),
  updateSubmissionOperation,
);

export const publishQueueForOrganization = withChange<Infer<typeof publishQueueArgs>, Awaited<ReturnType<typeof publishQueueOperation>>>(
  () => ({ kind: "queue_published", summary: "published the lineup" }),
  publishQueueOperation,
);

export const setStageScreenModeForOrganization = withChange<Infer<typeof setStageScreenModeArgs>, Awaited<ReturnType<typeof setStageScreenModeOperation>>>(
  (_ctx, args) => ({ kind: "stage_screen_mode", summary: args.mode === "qr" ? "put the QR on stage" : "put the lineup on stage" }),
  setStageScreenModeOperation,
);

export const setSubmissionCountVisibleForOrganization = withChange<Infer<typeof setSubmissionCountVisibleArgs>, Awaited<ReturnType<typeof setSubmissionCountVisibleOperation>>>(
  (_ctx, args) => ({ kind: "stage_count_visible", summary: `${args.visible ? "showed" : "hid"} the submission count on stage` }),
  setSubmissionCountVisibleOperation,
);

export const setStageMeetLinkVisibleForOrganization = withChange<Infer<typeof setStageMeetLinkVisibleArgs>, Awaited<ReturnType<typeof setStageMeetLinkVisibleOperation>>>(
  (_ctx, args) => ({ kind: "stage_meet_link_visible", summary: `${args.visible ? "showed" : "hid"} the meet link on stage` }),
  setStageMeetLinkVisibleOperation,
);

export const setStageTimerVisibleForOrganization = withChange<Infer<typeof setStageTimerVisibleArgs>, Awaited<ReturnType<typeof setStageTimerVisibleOperation>>>(
  (_ctx, args) => ({ kind: "stage_timer_visible", summary: `${args.visible ? "showed" : "hid"} the timer on stage` }),
  setStageTimerVisibleOperation,
);

export const setStageResultsShowFinalistsForOrganization = withChange<Infer<typeof setStageResultsShowFinalistsArgs>, Awaited<ReturnType<typeof setStageResultsShowFinalistsOperation>>>(
  (_ctx, args) => ({ kind: "stage_results_finalists", summary: args.showFinalists ? "set the stage to show the winners and finalists at the end" : "set the stage to show only the winners at the end" }),
  setStageResultsShowFinalistsOperation,
);

export const setStageTimerDurationForOrganization = withChange<Infer<typeof setStageTimerDurationArgs>, Awaited<ReturnType<typeof setStageTimerDurationOperation>>>(
  (_ctx, args) => ({ kind: "stage_timer_duration", summary: `set the stage timer to ${amountOfTime(args.durationMs)}` }),
  setStageTimerDurationOperation,
);

export const startStageTimerForOrganization = withChange<Infer<typeof startStageTimerArgs>, Awaited<ReturnType<typeof startStageTimerOperation>>>(
  () => ({ kind: "stage_timer_started", summary: "started the stage timer" }),
  startStageTimerOperation,
);

export const pauseStageTimerForOrganization = withChange<Infer<typeof pauseStageTimerArgs>, Awaited<ReturnType<typeof pauseStageTimerOperation>>>(
  () => ({ kind: "stage_timer_paused", summary: "paused the stage timer" }),
  pauseStageTimerOperation,
);

export const resetStageTimerForOrganization = withChange<Infer<typeof resetStageTimerArgs>, Awaited<ReturnType<typeof resetStageTimerOperation>>>(
  () => ({ kind: "stage_timer_reset", summary: "reset the stage timer" }),
  resetStageTimerOperation,
);

export const adjustStageTimerForOrganization = withChange<Infer<typeof adjustStageTimerArgs>, Awaited<ReturnType<typeof adjustStageTimerOperation>>>(
  (_ctx, args) => ({ kind: "stage_timer_adjusted", summary: `${args.deltaMs >= 0 ? "added" : "took off"} ${amountOfTime(args.deltaMs)} on the stage timer` }),
  adjustStageTimerOperation,
);

export const setDemoTimerVisibleForOrganization = withChange<Infer<typeof setDemoTimerVisibleArgs>, Awaited<ReturnType<typeof setDemoTimerVisibleOperation>>>(
  (_ctx, args) => ({ kind: "demo_timer_visible", summary: `${args.visible ? "showed" : "hid"} the demo timer on stage` }),
  setDemoTimerVisibleOperation,
);

export const setDemoTimerDurationForOrganization = withChange<Infer<typeof setDemoTimerDurationArgs>, Awaited<ReturnType<typeof setDemoTimerDurationOperation>>>(
  (_ctx, args) => ({ kind: "demo_timer_duration", summary: `set the demo timer to ${amountOfTime(args.durationMs)}` }),
  setDemoTimerDurationOperation,
);

export const startDemoTimerForOrganization = withChange<Infer<typeof startDemoTimerArgs>, Awaited<ReturnType<typeof startDemoTimerOperation>>>(
  () => ({ kind: "demo_timer_started", summary: "started the demo timer" }),
  startDemoTimerOperation,
);

export const pauseDemoTimerForOrganization = withChange<Infer<typeof pauseDemoTimerArgs>, Awaited<ReturnType<typeof pauseDemoTimerOperation>>>(
  () => ({ kind: "demo_timer_paused", summary: "paused the demo timer" }),
  pauseDemoTimerOperation,
);

export const adjustDemoTimerForOrganization = withChange<Infer<typeof adjustDemoTimerArgs>, Awaited<ReturnType<typeof adjustDemoTimerOperation>>>(
  (_ctx, args) => ({ kind: "demo_timer_adjusted", summary: `${args.deltaMs >= 0 ? "added" : "took off"} ${amountOfTime(args.deltaMs)} on the demo timer` }),
  adjustDemoTimerOperation,
);

export const hideSubmissionForOrganization = withChange<Infer<typeof hideSubmissionArgs>, Awaited<ReturnType<typeof hideSubmissionOperation>>>(
  async (ctx, args, event) => ({ kind: "submission_hidden", summary: `hid ${await submissionTitle(ctx, event, args.submissionId)}`, undoLabel: "Restore", subjectId: args.submissionId, watch: { submissions: [args.submissionId], teamMembers: [args.submissionId] } }),
  hideSubmissionOperation,
);

export const restoreSubmissionForOrganization = withChange<Infer<typeof restoreSubmissionArgs>, Awaited<ReturnType<typeof restoreSubmissionOperation>>>(
  async (ctx, args, event) => ({ kind: "submission_restored", summary: `restored ${await submissionTitle(ctx, event, args.submissionId)}`, subjectId: args.submissionId, watch: { submissions: [args.submissionId], teamMembers: [args.submissionId] } }),
  restoreSubmissionOperation,
);

export const reorderLineupForOrganization = withChange<Infer<typeof reorderLineupArgs>, Awaited<ReturnType<typeof reorderLineupOperation>>>(
  () => ({ kind: "lineup_reordered", summary: "reordered the lineup", watch: { submissions: "all", teamMembers: "all" } }),
  reorderLineupOperation,
);

export const shuffleLineupForOrganization = withChange<Infer<typeof shuffleLineupArgs>, Awaited<ReturnType<typeof shuffleLineupOperation>>>(
  () => ({ kind: "lineup_shuffled", summary: "shuffled the lineup", watch: { submissions: "all" } }),
  shuffleLineupOperation,
);

export const setLineupOrderForOrganization = withChange<Infer<typeof setLineupOrderArgs>, Awaited<ReturnType<typeof setLineupOrderOperation>>>(
  () => ({ kind: "lineup_reordered", summary: "reordered the lineup", watch: { submissions: "all", teamMembers: "all" } }),
  setLineupOrderOperation,
);

export const moveToPoolForOrganization = withChange<Infer<typeof moveToPoolArgs>, Awaited<ReturnType<typeof moveToPoolOperation>>>(
  async (ctx, args, event) => ({ kind: "moved_to_pool", summary: `moved ${await submissionTitle(ctx, event, args.submissionId)} to the pool`, subjectId: args.submissionId, watch: { submissions: "all" } }),
  moveToPoolOperation,
);

export const setLineupTargetForOrganization = withChange<Infer<typeof setLineupTargetArgs>, Awaited<ReturnType<typeof setLineupTargetOperation>>>(
  (_ctx, args) => ({ kind: "lineup_target", summary: `set the lineup to ${args.target} presenters` }),
  setLineupTargetOperation,
);

export const markNoShowForOrganization = withChange<Infer<typeof markNoShowArgs>, Awaited<ReturnType<typeof markNoShowOperation>>>(
  () => ({ kind: "no_show", summary: "marked the presenter as a no-show", watch: { submissions: "all" } }),
  markNoShowOperation,
);

export const pickNextForOrganization = withChange<Infer<typeof pickNextArgs>, Awaited<ReturnType<typeof pickNextOperation>>>(
  () => ({ kind: "presenter_advanced", summary: "moved to the next presenter", watch: { submissions: "all" } }),
  pickNextOperation,
);

export const restorePreviousPresenterForOrganization = withChange<Infer<typeof restorePreviousPresenterArgs>, Awaited<ReturnType<typeof restorePreviousPresenterOperation>>>(
  () => ({ kind: "presenter_restored", summary: "brought back the previous presenter", watch: { submissions: "all" } }),
  restorePreviousPresenterOperation,
);

export const skipCurrentForOrganization = withChange<Infer<typeof skipCurrentArgs>, Awaited<ReturnType<typeof skipCurrentOperation>>>(
  () => ({ kind: "presenter_skipped", summary: "skipped the current presenter", watch: { submissions: "all" } }),
  skipCurrentOperation,
);

export const clearQueueForOrganization = withChange<Infer<typeof clearQueueArgs>, Awaited<ReturnType<typeof clearQueueOperation>>>(
  () => ({ kind: "queue_cleared", summary: "cleared every submission", undo: "none", watch: { submissions: "all", teamMembers: "all" } }),
  clearQueueOperation,
);

export const setStageTimerRemainingForOrganization = withChange<Infer<typeof setStageTimerRemainingArgs>, Awaited<ReturnType<typeof setStageTimerRemainingOperation>>>(
  (_ctx, args) => ({ kind: "stage_timer_remaining", summary: `set the stage timer to ${amountOfTime(Math.max(0, args.remainingMs))} left` }),
  setStageTimerRemainingOperation,
);
