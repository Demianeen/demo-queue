// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { scrubSecretPaths, scrubUrl } from "./analytics-url.ts";

/**
 * Free text that reaches analytics (error messages, an MCP agent's reason for
 * a call) with anything shaped like personal data or a secret replaced by
 * `[redacted]`, then cut to `max` characters. Whole URLs go, paths included:
 * a profile or repository path names a person or a project. Names of people have no shape,
 * so they cannot be caught here: text that may hold them must not be sent.
 */
export function redactText(text: string, max = 2048): string {
  // Cut first: some of these patterns backtrack, and the text can be an agent's.
  const redacted = scrubSecretPaths(text.slice(0, max * 2))
    // A URL ends before trailing punctuation, so the sentence around it survives.
    .replace(/\b(?:https?:\/\/|www\.)[^\s"'<>]*[^\s"'<>.,;:!?)]/gi, "[redacted]")
    .replace(/\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,5}\.[a-z]{2,24}\/(?:[^\s"'<>]*[^\s"'<>.,;:!?)])?/gi, "[redacted]")
    .replace(/[^\s@<>"'(),;:]{1,64}@[^\s@<>"'(),;:]{1,255}\.[A-Za-z]{2,24}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(authorization|cookie|token|password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?key)("?\s*[:=]\s*"?)[^\s,;"'&]+/gi, "$1$2[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, (word) => (/\d/.test(word) && /[A-Za-z]/.test(word) ? "[redacted]" : word))
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (number) => (number.replace(/\D/g, "").length >= 9 ? "[redacted]" : number));
  return redacted.length > max ? redacted.slice(0, max) : redacted;
}

/**
 * An `$exception_list` ready to send: each message redacted, and every other
 * string (stack frame file names can be the page URL) cleared of secret paths
 * and query strings.
 */
export function redactExceptionList(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!item || typeof item !== "object") return item;
    const { value, ...rest } = item as { value?: unknown };
    return { ...scrubStrings(rest) as object, ...(typeof value === "string" ? { value: redactText(value) } : {}) };
  });
}

function scrubStrings(value: unknown): unknown {
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? scrubUrl(value) : scrubSecretPaths(value);
  if (Array.isArray(value)) return value.map(scrubStrings);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubStrings(item)]));
  return value;
}
