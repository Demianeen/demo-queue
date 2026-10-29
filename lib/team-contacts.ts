import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { SUBMISSION_FIELD_LIMITS, isValidGithubProfile, isValidLinkedin, isValidTwitter } from "./validation.ts";

export const TEAM_CONTACT_FIELD_LIMITS = {
  name: 60,
  email: 254,
  whatsappPhone: 32,
} as const;

export type TeamContact = {
  name: string;
  email: string;
  whatsappPhone: string;
  twitter?: string;
  linkedin?: string;
  githubProfile?: string;
};

function optionalSocial(limit: number, label: string, isValid: (value: string) => boolean, message: string) {
  return z
    .string()
    .trim()
    .max(limit, `${label} must be ${limit} characters or fewer.`)
    .optional()
    .transform((value) => value || undefined)
    .refine((value) => value === undefined || isValid(value), message);
}

export function normalizeInternationalPhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("+") || trimmed.length > TEAM_CONTACT_FIELD_LIMITS.whatsappPhone) {
    return null;
  }

  const phoneNumber = parsePhoneNumberFromString(trimmed);
  return phoneNumber?.isValid() ? phoneNumber.number : null;
}

export const teamContactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter this team member's name.")
    .max(
      TEAM_CONTACT_FIELD_LIMITS.name,
      `Name must be ${TEAM_CONTACT_FIELD_LIMITS.name} characters or fewer.`,
    ),
  email: z
    .string()
    .trim()
    .max(
      TEAM_CONTACT_FIELD_LIMITS.email,
      `Email must be ${TEAM_CONTACT_FIELD_LIMITS.email} characters or fewer.`,
    )
    .pipe(z.email("Enter a valid email address.")),
  whatsappPhone: z
    .string()
    .trim()
    .max(
      TEAM_CONTACT_FIELD_LIMITS.whatsappPhone,
      `WhatsApp number must be ${TEAM_CONTACT_FIELD_LIMITS.whatsappPhone} characters or fewer.`,
    )
    .refine(
      (value) => normalizeInternationalPhone(value) !== null,
      "Enter a valid international number including the country code, such as +44.",
    )
    .transform((value) => normalizeInternationalPhone(value)!),
  twitter: optionalSocial(SUBMISSION_FIELD_LIMITS.twitter, "X", isValidTwitter, "Enter an X @handle or an x.com link."),
  linkedin: optionalSocial(SUBMISSION_FIELD_LIMITS.linkedin, "LinkedIn", isValidLinkedin, "Enter a linkedin.com/in/... link."),
  githubProfile: optionalSocial(
    SUBMISSION_FIELD_LIMITS.githubProfile,
    "GitHub",
    isValidGithubProfile,
    "Enter a GitHub username or github.com link.",
  ),
});

export type TeamContactInput = z.input<typeof teamContactSchema>;

export function parseTeamContact(value: TeamContactInput): TeamContact {
  return teamContactSchema.parse(value);
}
