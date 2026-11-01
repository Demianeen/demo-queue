import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
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

/**
 * Reads a WhatsApp number typed with its country code: with a +, with 00 for
 * the +, or bare ("44 7442 106036"). A number starting with a single 0 has no
 * country code and is never guessed, nor is anything else (letters, an empty
 * field): undefined.
 */
function readWhatsAppNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return parsePhoneNumberFromString(trimmed);
  if (trimmed.startsWith("00")) return parsePhoneNumberFromString(`+${trimmed.slice(2)}`);
  return /^[1-9][\d\s().-]*$/.test(trimmed) ? parsePhoneNumberFromString(`+${trimmed}`) : undefined;
}

export function normalizeInternationalPhone(value: string) {
  const trimmed = value.trim();
  if (trimmed.length > TEAM_CONTACT_FIELD_LIMITS.whatsappPhone) return null;
  const phoneNumber = readWhatsAppNumber(trimmed);
  return phoneNumber?.isValid() ? phoneNumber.number : null;
}

/** A valid WhatsApp number spaced the international way ("+44 7442 106036"); anything else stays as typed. */
export function formatWhatsAppPhone(value: string) {
  const phoneNumber = readWhatsAppNumber(value);
  return phoneNumber?.isValid() ? phoneNumber.formatInternational() : value;
}

/**
 * Spaces a WhatsApp number while it is typed. A bare number gets its + at
 * once; one starting with a single 0 stays as typed, for validation to ask
 * for the country code.
 */
export function formatWhatsAppAsYouType(value: string) {
  const trimmed = value.trimStart();
  const international = trimmed.startsWith("+") ? trimmed : trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : /^[1-9]/.test(trimmed) ? `+${trimmed}` : null;
  return international ? new AsYouType().input(international) : value;
}

/** The country a valid WhatsApp number belongs to ("United Kingdom"), so a wrong guess shows; null otherwise. */
export function whatsAppCountryName(value: string) {
  const phoneNumber = readWhatsAppNumber(value);
  if (!phoneNumber?.isValid() || !phoneNumber.country) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(phoneNumber.country) ?? null;
  } catch {
    return null;
  }
}

/**
 * Spaces a full international number the way it is written ("+44 7700
 * 900123"), reading a leading 00 as +. Anything else stays as typed, for
 * validation to explain.
 */
export function formatInternationalPhone(value: string) {
  const trimmed = value.trim();
  const international = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  if (!international.startsWith("+")) return value;
  const phoneNumber = parsePhoneNumberFromString(international);
  return phoneNumber?.isValid() ? phoneNumber.formatInternational() : value;
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
      "Enter a valid WhatsApp number with its country code, such as +44 7700 900123.",
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
