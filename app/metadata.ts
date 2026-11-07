import { cache } from "react";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getEnv } from "./env";
import { convexErrorText } from "@/lib/convex-error";
import { reportCaughtServerError } from "@/lib/posthog-server";

const client = new ConvexHttpClient(getEnv().NEXT_PUBLIC_CONVEX_URL);

// One request per page render: the title and the page both ask.
const eventMeta = cache((slug: string) => client.query(api.events.getEventMeta, { slug }));

// A public link whose slug matches no event is a 404, decided here on the
// server: the browser's own query for the event would otherwise fail into the
// root error page. A page body must await eventLook too, because notFound()
// from generateMetadata alone arrives after the 200 status has gone out.
export async function eventTitle(slug: string) {
  try {
    const event = await eventMeta(slug);
    return event.name;
  } catch (error) {
    if (isNotFound(error)) notFound();
    await reportCaughtServerError(error, "event-title");
    throw error;
  }
}

/** The event's name, type and look, or null if it cannot be read: the page then loads plain. */
export async function eventLook(slug: string) {
  try {
    const { name, eventType, visualStyle, theme } = await eventMeta(slug);
    return { name, eventType, visualStyle, theme };
  } catch (error) {
    if (isNotFound(error)) notFound();
    await reportCaughtServerError(error, "event-look");
    return null;
  }
}

/** Null when the submission is gone: the status page's own error page explains that. */
export async function participantTitle(slug: string, participantToken: string) {
  try {
    const participant = await client.query(api.events.getParticipantMeta, { slug, participantToken });
    return {
      eventName: participant.event.name,
      demoTitle: participant.submission.demoTitle,
    };
  } catch (error) {
    if (isNotFound(error)) notFound();
    if (isSubmissionNotFound(error)) return null;
    await reportCaughtServerError(error, "status-title");
    throw error;
  }
}

function isNotFound(error: unknown) {
  return convexErrorText(error) === "Event not found";
}

function isSubmissionNotFound(error: unknown) {
  return convexErrorText(error) === "Submission not found";
}
