/**
 * A new practice event's name when the organiser types none: what it starts
 * from, numbered past the names other practice events already have, so two
 * events never look the same. The form shows this exact name, and the server
 * picks it the same way.
 */
export function practiceEventName(start: { sourceName?: string | null; eventType: "hackathon" | "demo" }, taken: Iterable<string>) {
  const base = (start.sourceName ? `Dry run for ${start.sourceName}` : start.eventType === "hackathon" ? "Practice hackathon" : "Practice demo night").slice(0, 150);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let number = 2;
  while (used.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}
