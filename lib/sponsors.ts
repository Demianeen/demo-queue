// Shared, framework-free rules for a hackathon's sponsors. Used by the Convex
// functions and by the forms so both enforce the same limits.

// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { trackKey } from "./tracks.ts";

export const MAX_EVENT_SPONSORS = 10;
export const MAX_SPONSOR_NAME_LENGTH = 40;
export const MAX_SPONSOR_USAGE_LENGTH = 140;
export const SPONSOR_USAGE_PLACEHOLDER = "What counts as using it";

/** A sponsor: its name, and what counts as using it, which the AI read checks each project for. */
export type SponsorInput = { name: string; usage?: string };

export function normalizeSponsorInput(input: SponsorInput): SponsorInput {
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  const usage = input.usage?.trim().replace(/\s+/g, " ") || undefined;
  if (!name) throw new Error("Enter a sponsor name.");
  if (name.length > MAX_SPONSOR_NAME_LENGTH) throw new Error(`Sponsor names must be ${MAX_SPONSOR_NAME_LENGTH} characters or fewer.`);
  if (usage && usage.length > MAX_SPONSOR_USAGE_LENGTH) throw new Error(`Keep "what counts as using it" to ${MAX_SPONSOR_USAGE_LENGTH} characters or fewer.`);
  return { name, usage };
}

/** A whole sponsor list (event creation): blank rows dropped, names unique ignoring case. */
export function normalizeSponsorList(inputs: SponsorInput[]): SponsorInput[] {
  const sponsors = inputs.filter((input) => input.name.trim() || input.usage?.trim()).map(normalizeSponsorInput);
  if (sponsors.length > MAX_EVENT_SPONSORS) throw new Error(`Add no more than ${MAX_EVENT_SPONSORS} sponsors.`);
  const seen = new Set<string>();
  for (const sponsor of sponsors) {
    const key = trackKey(sponsor.name);
    if (seen.has(key)) throw new Error(`Each sponsor needs a different name. "${sponsor.name}" is listed twice.`);
    seen.add(key);
  }
  return sponsors;
}

export function sponsorKey(name: string) {
  return trackKey(name);
}
