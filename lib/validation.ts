// Shared, framework-free validators used by both the submission form and the
// participant contact-edit form so the two stay consistent.

import { z } from "zod";

export const SUBMISSION_FIELD_LIMITS = {
  name: 60,
  demoTitle: 64,
  description: 240,
  phone: 32,
  email: 254,
  twitter: 200,
  linkedin: 300,
  category: 10,
} as const;

export type SubmissionFieldName = keyof typeof SUBMISSION_FIELD_LIMITS;

export const SUBMISSION_FIELD_LABELS: Record<SubmissionFieldName, string> = {
  name: "Name",
  demoTitle: "Demo title",
  description: "Description",
  phone: "Phone number",
  email: "Email",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
  category: "Category",
};

function fieldLimitMessage(field: SubmissionFieldName) {
  return `${SUBMISSION_FIELD_LABELS[field]} must be ${SUBMISSION_FIELD_LIMITS[field]} characters or fewer.`;
}

function limitedString(field: SubmissionFieldName) {
  return z.string().trim().max(SUBMISSION_FIELD_LIMITS[field], fieldLimitMessage(field));
}

function optionalLimitedString(field: SubmissionFieldName) {
  return limitedString(field).optional().transform((value) => value || undefined);
}

export const submissionTextSchema = z.object({
  name: limitedString("name"),
  demoTitle: limitedString("demoTitle"),
  description: limitedString("description"),
  phone: limitedString("phone"),
  email: optionalLimitedString("email"),
  twitter: optionalLimitedString("twitter"),
  linkedin: optionalLimitedString("linkedin"),
  category: optionalLimitedString("category"),
});

export const contactTextSchema = submissionTextSchema.pick({
  phone: true,
  email: true,
  twitter: true,
  linkedin: true,
});

export type SubmissionTextInput = z.input<typeof submissionTextSchema>;
export type ContactTextInput = z.input<typeof contactTextSchema>;

export function parseSubmissionTextFields(fields: SubmissionTextInput) {
  return submissionTextSchema.parse(fields);
}

export function parseContactTextFields(fields: ContactTextInput) {
  return contactTextSchema.parse(fields);
}

export function isWithinFieldLimit(field: SubmissionFieldName, value: string) {
  return limitedString(field).safeParse(value).success;
}

export function fieldLimitError(field: SubmissionFieldName, value: string) {
  const parsed = limitedString(field).safeParse(value);
  if (parsed.success) return "";
  return parsed.error.issues[0]?.message ?? fieldLimitMessage(field);
}

export function firstFieldLimitError(fields: Partial<Record<SubmissionFieldName, string>>) {
  for (const field of Object.keys(fields) as SubmissionFieldName[]) {
    const error = fieldLimitError(field, fields[field] ?? "");
    if (error) return error;
  }

  return "";
}

export function isValidPhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  // Allow +, spaces, dashes, parens, dots; require 7-15 digits (ITU E.164 max).
  return /^[+()\-.\s\d]+$/.test(trimmed) && digits.length >= 7 && digits.length <= 15;
}

// Accept an @handle (1-15 word chars, optional leading @) or a twitter.com/x.com URL.
export function isValidTwitter(value: string) {
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(value)) return true;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return /(^|\.)(twitter\.com|x\.com)$/.test(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}

// Accept a linkedin.com/... URL or an "in/handle" path.
export function isValidLinkedin(value: string) {
  if (/^in\/[A-Za-z0-9\-_%.]+$/.test(value)) return true;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return /(^|\.)linkedin\.com$/.test(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}
