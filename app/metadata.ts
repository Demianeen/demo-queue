import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { env } from "./env";

const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

export async function eventTitle(slug: string) {
  try {
    const event = await client.query(api.events.getEventMeta, { slug });
    return event.name;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function adminEventTitle(slug: string, adminToken: string) {
  try {
    const event = await client.query(api.events.getAdminEventMeta, { slug, adminToken });
    return event.name;
  } catch (error) {
    if (isNotFound(error) || isUnauthorized(error)) return null;
    throw error;
  }
}

export async function participantTitle(slug: string, participantToken: string) {
  try {
    const participant = await client.query(api.events.getParticipantMeta, { slug, participantToken });
    return {
      eventName: participant.event.name,
      demoTitle: participant.submission.demoTitle,
    };
  } catch (error) {
    if (isNotFound(error) || isSubmissionNotFound(error)) return null;
    throw error;
  }
}

function isNotFound(error: unknown) {
  return errorMessage(error).includes("Event not found");
}

function isUnauthorized(error: unknown) {
  return errorMessage(error).includes("Unauthorized");
}

function isSubmissionNotFound(error: unknown) {
  return errorMessage(error).includes("Submission not found");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
