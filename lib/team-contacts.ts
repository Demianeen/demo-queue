import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

export const TEAM_CONTACT_FIELD_LIMITS = {
  name: 60,
  email: 254,
  whatsappPhone: 32,
} as const;

export type TeamContact = {
  name: string;
  email: string;
  whatsappPhone: string;
};

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
});

export type TeamContactInput = z.input<typeof teamContactSchema>;

export function parseTeamContact(value: TeamContactInput): TeamContact {
  return teamContactSchema.parse(value);
}
