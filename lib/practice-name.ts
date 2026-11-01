const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A new practice event's name when the organiser types none: what it starts
 * from and the day it was made ("Practice hackathon, 31 Oct"), numbered past
 * names other practice events already have, so two events never look the
 * same. The form shows this name (with the organiser's own date) and sends
 * it; the server picks it the same way, in UTC, only when none is sent.
 */
export function practiceEventName(start: { sourceName?: string | null; eventType: "hackathon" | "demo" }, taken: Iterable<string>, now: Date, utc = false) {
  const day = utc ? now.getUTCDate() : now.getDate();
  const month = MONTHS[utc ? now.getUTCMonth() : now.getMonth()];
  const kind = start.sourceName ? `Dry run for ${start.sourceName}` : start.eventType === "hackathon" ? "Practice hackathon" : "Practice demo night";
  const base = `${kind.slice(0, 140)}, ${day} ${month}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let number = 2;
  while (used.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}
