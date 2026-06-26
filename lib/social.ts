export function socialUrl(kind: "twitter" | "linkedin", value: string) {
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(x\.com|twitter\.com)\//i.test(trimmed)) return `https://${trimmed}`;
  if (/^(www\.)?linkedin\.com\//i.test(trimmed)) return `https://${trimmed}`;

  const clean = trimmed.replace(/^@/, "").replace(/^\/+/, "");
  if (kind === "twitter") return `https://x.com/${clean}`;
  if (clean.startsWith("in/")) return `https://www.linkedin.com/${clean}`;
  return `https://www.linkedin.com/in/${clean}`;
}
