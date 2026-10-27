import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { env, internalMutation } from "./_generated/server";
import { listEventTracks, trackNamesFor, tracksById } from "./tracks";
import { emailKey } from "../lib/validation";
import { participantPath } from "../lib/routes";
import { buildSubmissionEmail, emailSender } from "../lib/submission-email";

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
 * goes to everyone on the team who gave an email; "email me the link again"
 * sends it only to the address that asked.
 */
export const sendStatusLinkEmail = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    to: v.optional(v.string()),
    reason: v.union(v.literal("submitted"), v.literal("resend")),
  },
  handler: async (ctx, args) => {
    const base = { submissionId: args.submissionId, reason: args.reason };
    const submission = await ctx.db.get(args.submissionId);
    const event = submission ? await ctx.db.get(submission.eventId) : null;
    if (!submission || !event || submission.status === "withdrawn") {
      logEmail({ ...base, status: "skipped", why: "submission_unavailable" });
      return { sent: 0 };
    }

    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .take(50);
    const recipients = emailRecipients(submission, members, args.to);
    if (recipients.length === 0) {
      logEmail({ ...base, status: "skipped", why: "no_recipient" });
      return { sent: 0 };
    }

    const config = emailConfig();
    if (!config.ok) {
      logEmail({ ...base, status: "skipped", why: "not_configured", missing: config.missing });
      return { sent: 0 };
    }

    const tracks = trackNamesFor(submission, tracksById(await listEventTracks(ctx, event._id)));
    const statusUrl = new URL(participantPath(event.slug, submission.participantToken), config.siteUrl).toString();
    const resend = new Resend(components.resend, { apiKey: config.apiKey, testMode: false });
    const from = emailSender(event.name, config.from);
    for (const recipient of recipients) {
      const message = buildSubmissionEmail({
        reason: args.reason,
        eventName: event.name,
        eventType: event.eventType ?? "demo",
        recipientName: recipient.name,
        demoTitle: submission.demoTitle,
        teamName: submission.teamName,
        people: [submission.name, ...members.map((member) => member.name)],
        tracks,
        githubUrl: submission.githubUrl,
        videoUrl: submission.videoUrl,
        statusUrl,
      });
      await resend.sendEmail(ctx, { from, to: recipient.email, ...message });
    }
    logEmail({ ...base, status: "queued", recipients: recipients.length });
    return { sent: recipients.length };
  },
});

function emailRecipients(
  submission: Doc<"submissions">,
  members: Doc<"teamMembers">[],
  onlyTo: string | undefined,
) {
  const people = [
    { name: submission.name, email: submission.email },
    ...members.map((member) => ({ name: member.name, email: member.email })),
  ];
  const seen = new Set<string>();
  const recipients: Array<{ name: string; email: string }> = [];
  for (const person of people) {
    if (!person.email) continue;
    const key = emailKey(person.email);
    if (seen.has(key)) continue;
    // A resend goes only to the person who asked, and only if they are on this submission.
    if (onlyTo !== undefined && key !== emailKey(onlyTo)) continue;
    seen.add(key);
    recipients.push({ name: person.name, email: person.email });
  }
  return recipients;
}
