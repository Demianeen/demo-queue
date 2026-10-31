/**
 * The command menu's model: what a row is, how a query ranks rows, and which
 * groups show in which order. No React here, so it runs under `node --test`.
 */

/** One row: a command registered by the shell or a page, or an event found by search. */
export type MenuEntry = {
  id: string;
  title: string;
  /** Muted text on the right: where it lives or its state ("Practice · Queue"). */
  subtitle?: string;
  /** Other words that find it. */
  keywords?: string[];
  group: string;
  keys?: string[];
  disabled?: boolean;
  /** Shown before anything is typed, in a group that is otherwise search only (recent events). */
  suggested?: boolean;
};

export const LIVE_GROUP = "Live now";
export const PAGE_GROUP = "This page";
export const EVENTS_GROUP = "Events";

/** The live event's group carries its name: "Live now · Demo night". */
export function liveGroup(eventName: string) {
  return `${LIVE_GROUP} · ${eventName}`;
}

export function isLiveGroup(group: string) {
  return group === LIVE_GROUP || group.startsWith(`${LIVE_GROUP} · `);
}

/**
 * Groups in a fixed order, so rows never jump between groups as you type.
 * The live event first, then this page, events, creating, pages, and the rest.
 */
const GROUP_ORDER = [LIVE_GROUP, PAGE_GROUP, EVENTS_GROUP, "Create", "Go to", "Switch organization", "Help"];

/** Before anything is typed: the live event's places, recent events, creating, pages and help. */
const SUGGESTED_GROUPS = new Set([LIVE_GROUP, EVENTS_GROUP, "Create", "Go to", "Help"]);

/** Rows per group once you type, applied after ranking so a cap never hides a better match. */
export const GROUP_CAP = 7;

function groupKey(group: string) {
  return isLiveGroup(group) ? LIVE_GROUP : group;
}

export function groupRank(group: string) {
  const index = GROUP_ORDER.indexOf(groupKey(group));
  return index === -1 ? GROUP_ORDER.length : index;
}

// ─── Ranking ──────────────────────────────────────────────────────────────
// After fleetos's palette: match quality beats field. A prefix of the whole
// text beats a word start, which beats a substring, which beats the letters
// in order. A title hit beats the same hit in a keyword, subtitle or group.

const STRENGTH = { prefix: 1, wordPrefix: 0.8, substring: 0.6, fuzzy: 0.3 } as const;
const WEIGHT = { title: 1, keywords: 0.9, subtitle: 0.8, group: 0.7 } as const;
const WORD = /[\s\-_/·:]+/;

function isSubsequence(haystack: string, needle: string) {
  let matched = 0;
  for (const char of haystack) {
    if (char === needle[matched]) matched += 1;
    if (matched === needle.length) return true;
  }
  return false;
}

function strength(haystack: string | undefined, needle: string, fuzzy: boolean) {
  if (!haystack) return 0;
  const text = haystack.toLowerCase();
  if (text.startsWith(needle)) return STRENGTH.prefix;
  if (text.split(WORD).some((word) => word.startsWith(needle))) return STRENGTH.wordPrefix;
  if (text.includes(needle)) return STRENGTH.substring;
  return fuzzy && needle.length > 1 && isSubsequence(text, needle) ? STRENGTH.fuzzy : 0;
}

/** Best weighted match of one needle across the row's fields. Letters in order count only in the title. */
function fieldScore(entry: MenuEntry, needle: string) {
  let best = WEIGHT.title * strength(entry.title, needle, true);
  for (const keyword of entry.keywords ?? []) best = Math.max(best, WEIGHT.keywords * strength(keyword, needle, false));
  best = Math.max(best, WEIGHT.subtitle * strength(entry.subtitle, needle, false));
  best = Math.max(best, WEIGHT.group * strength(entry.group, needle, false));
  return best;
}

/**
 * How well the query matches a row; 0 is no match. Several words also match
 * when each one hits some field, so "mcp queue" finds the live event's Queue.
 */
export function textScore(query: string, entry: MenuEntry) {
  const needle = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return 0;
  const whole = fieldScore(entry, needle);
  const words = needle.split(" ");
  if (words.length < 2) return whole;
  const each = words.map((word) => fieldScore(entry, word));
  const allWords = each.every((score) => score > 0) ? Math.min(...each) * 0.9 : 0;
  return Math.max(whole, allWords);
}

/** Scores below this only matched letters in order, never a word or a part of one. */
const LETTERS_ONLY = STRENGTH.fuzzy + 0.01;

/**
 * Matching rows, best first. Ties keep their order, so the list never shuffles.
 * `floor` drops weaker rows: the menu passes LETTERS_ONLY when any row matched
 * properly, so letters-in-order hits are a fallback and never sit first.
 */
export function rankEntries<T extends MenuEntry>(query: string, entries: readonly T[], floor = 0): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: textScore(query, entry) }))
    .filter((item) => item.score > 0 && item.score >= floor)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}

/**
 * One row per group and title. Two pages can register the same action (the
 * header's and the page's "Open presentation view"); the one with keys stays,
 * where the first of them stood.
 */
export function dedupeEntries<T extends MenuEntry>(entries: readonly T[]): T[] {
  const kept = new Map<string, number>();
  const out: T[] = [];
  for (const entry of entries) {
    const key = `${entry.group}\u0000${entry.title.toLowerCase()}`;
    const at = kept.get(key);
    if (at === undefined) { kept.set(key, out.length); out.push(entry); }
    else if (!out[at].keys?.length && entry.keys?.length) out[at] = entry;
  }
  return out;
}

// ─── Sections ─────────────────────────────────────────────────────────────

export type SectionStatus = "loading" | "error";

export type MenuSection<T extends MenuEntry = MenuEntry> = {
  group: string;
  entries: T[];
  /** Set while the group's data loads or after it fails; its rows so far still show. */
  status?: SectionStatus;
};

/**
 * The groups to show for a query, in their fixed order. Empty, the menu opens
 * on suggestions: every row of the suggested groups, and only the `suggested`
 * rows of Events. Typed, every group is ranked and capped. A group with a
 * status shows even when it has no rows yet, so its placeholder or error has
 * a place; any other empty group is left out.
 */
export function menuSections<T extends MenuEntry>(query: string, entries: readonly T[], status: Record<string, SectionStatus | undefined> = {}): MenuSection<T>[] {
  const typed = query.trim().length > 0;
  const groups: string[] = [];
  for (const entry of entries) if (!groups.includes(entry.group)) groups.push(entry.group);
  for (const group of Object.keys(status)) if (status[group] && !groups.includes(group)) groups.push(group);
  const ordered = groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.index - b.index)
    .map((item) => item.group);

  // Groups keep a fixed order, so a letters-in-order hit in an early group would
  // sit above a real match below it; drop those when anything matched properly.
  const floor = typed && entries.some((entry) => textScore(query, entry) >= LETTERS_ONLY) ? LETTERS_ONLY : 0;
  const sections: MenuSection<T>[] = [];
  for (const group of ordered) {
    const inGroup = entries.filter((entry) => entry.group === group);
    let shown: T[];
    if (typed) shown = rankEntries(query, inGroup, floor).slice(0, GROUP_CAP);
    else if (!SUGGESTED_GROUPS.has(groupKey(group))) continue;
    else shown = groupKey(group) === EVENTS_GROUP ? inGroup.filter((entry) => entry.suggested) : inGroup;
    const groupStatus = status[group];
    if (!shown.length && !groupStatus) continue;
    sections.push(groupStatus ? { group, entries: shown, status: groupStatus } : { group, entries: shown });
  }
  return sections;
}

/**
 * The row selected when the results change: the best match, wherever its
 * group sits, so Enter runs it; the first row before anything is typed.
 */
export function bestEntryId<T extends MenuEntry>(query: string, sections: readonly MenuSection<T>[]): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const section of sections) for (const entry of section.entries) {
    if (entry.disabled) continue;
    const score = query.trim() ? textScore(query, entry) : 0;
    if (!best || score > best.score) best = { id: entry.id, score };
  }
  return best?.id;
}
