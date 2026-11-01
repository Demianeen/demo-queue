import { Resend } from "@convex-dev/resend";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { env, internalMutation } from "./_generated/server";
import { listEventTracks, trackNamesFor, tracksById } from "./tracks";
import { emailKey } from "../lib/validation";
import { participantPath } from "../lib/routes";
import { buildSubmissionEmail, emailSender } from "../lib/submission-email";
import { eventProperties, track, trackException } from "./analytics";

/**
 * Submitting needs no sign-in, so emails are capped: a few per address per
 * hour across all events, and a ceiling per event. Over a cap, the email is
 * skipped and logged; the submission itself is unaffected.
 */
export const STATUS_EMAIL_LIMITS = {
  perAddress: { kind: "fixed window", rate: 5, period: HOUR },
  perEvent: { kind: "token bucket", rate: 600, period: HOUR, capacity: 400 },
} as const;

export const emailRateLimiter = new RateLimiter(components.rateLimiter, {
  statusEmailPerAddress: STATUS_EMAIL_LIMITS.perAddress,
  statusEmailPerEvent: STATUS_EMAIL_LIMITS.perEvent,
});

type EmailConfig =
  | { ok: true; apiKey: string; from: string; siteUrl: string }
  | { ok: false; missing: string[] };

/**
 * Sending needs a Resend API key, a sender address and the site's public URL
 * (for the status link). Without all three, emails are skipped and logged.
 */
export function emailConfig(): EmailConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  const siteUrl = env.DEMO_QUEUE_SITE_URL?.trim();
  if (apiKey && from && siteUrl) return { ok: true, apiKey, from, siteUrl };
  return {
    ok: false,
    missing: [
      ...(apiKey ? [] : ["RESEND_API_KEY"]),
      ...(from ? [] : ["RESEND_FROM_EMAIL"]),
      ...(siteUrl ? [] : ["DEMO_QUEUE_SITE_URL"]),
    ],
  };
}

function logEmail(details: Record<string, unknown>) {
  // Never log addresses, tokens or links.
  console.info("status-link-email", details);
}

/**
 * Emails the private status link with what was submitted. After a submit it
 * goes only to the presenter; a team member gets their own copy by asking
 * with "Email me the link again", which sends only to the address that asked.
 */
export const sendStatusLinkEmail = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    to: v.optional(v.string()),
    reason: v.union(v.literal("submitted"), v.literal("resend")),
  },
  handler: async (ctx, args) => {
    const base = { submissionId: args.submissionId, reason: args.reason };
    const kind = args.reason === "submitted" ? "status_link_submitted" : "status_link_resend";
    const submission = await ctx.db.get(args.submissionId);
    const event = submission ? await ctx.db.get(submission.eventId) : null;
    if (!submission || !event || submission.status === "withdrawn") {
      logEmail({ ...base, status: "skipped", why: "submission_unavailable" });
      return { sent: 0 };
    }
    const properties = { ...eventProperties(event), submission_id: submission._id, kind };
    const failed = (reason: string) => track(ctx, "email_failed", { kind: "system" }, { ...properties, reason });

    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .take(50);
    const recipient = emailRecipient(submission, members, args.reason === "resend" ? args.to : undefined);
    if (!recipient) {
      logEmail({ ...base, status: "skipped", why: "no_recipient" });
      await failed("no_recipient");
      return { sent: 0 };
    }

    const config = emailConfig();
    if (!config.ok) {
      logEmail({ ...base, status: "skipped", why: "not_configured", missing: config.missing });
      await failed("not_configured");
      return { sent: 0 };
    }

    const perAddress = await emailRateLimiter.limit(ctx, "statusEmailPerAddress", { key: emailKey(recipient.email) });
    if (!perAddress.ok) {
      logEmail({ ...base, status: "skipped", why: "rate_limited", limit: "per_address" });
      await failed("rate_limited_address");
      return { sent: 0 };
    }
    const perEvent = await emailRateLimiter.limit(ctx, "statusEmailPerEvent", { key: event._id });
    if (!perEvent.ok) {
      logEmail({ ...base, status: "skipped", why: "rate_limited", limit: "per_event" });
      await failed("rate_limited_event");
      return { sent: 0 };
    }

    const tracks = trackNamesFor(submission, tracksById(await listEventTracks(ctx, event._id)));
    const statusUrl = new URL(participantPath(event.slug, submission.participantToken), config.siteUrl).toString();
    const message = buildSubmissionEmail({
      reason: args.reason,
      eventName: event.name,
      eventType: event.eventType ?? "demo",
      recipientName: recipient.name,
      demoTitle: submission.demoTitle,
      teamName: submission.teamName,
      people: [submission.name, ...members.map((member) => member.name)],
      tracks,
      statusUrl,
    });
    const resend = new Resend(components.resend, { apiKey: config.apiKey, testMode: false });
    try {
      await resend.sendEmail(ctx, { from: emailSender(event.name, config.from), to: recipient.email, ...message });
    } catch (error) {
      // Resend refused to queue it (a bad sender or address): the submission stands, the email is reported.
      logEmail({ ...base, status: "failed", why: "send_error" });
      await failed("send_error");
      await trackException(ctx, error, { kind: "system" }, "emails.sendStatusLinkEmail", properties, { withMessage: false });
      return { sent: 0 };
    }
    logEmail({ ...base, status: "queued" });
    await track(ctx, "email_sent", { kind: "system" }, properties);
    return { sent: 1 };
  },
});

/**
 * The presenter, or for a resend the person on this submission who asked.
 * Nobody else is ever emailed.
 */
function emailRecipient(
  submission: Doc<"submissions">,
  members: Doc<"teamMembers">[],
  askedBy: string | undefined,
) {
  if (askedBy === undefined) {
    return submission.email ? { name: submission.name, email: submission.email } : null;
  }
  const key = emailKey(askedBy);
  const people = [
    { name: submission.name, email: submission.email },
    ...members.map((member) => ({ name: member.name, email: member.email })),
  ];
  const person = people.find((candidate) => candidate.email && emailKey(candidate.email) === key);
  return person?.email ? { name: person.name, email: person.email } : null;
}
