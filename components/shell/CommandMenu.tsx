"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Code2, FlaskConical, Presentation, Zap, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Command as CommandRoot, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useInPageNavigate } from "@/components/InPageLink";
import { phaseTabLabel } from "@/lib/admin-views";
import { adminPath } from "@/lib/routes";
import type { EventPhase } from "@/lib/event-phase";
import { bestEntryId, dedupeEntries, EVENTS_GROUP, isLiveGroup, LIVE_GROUP, menuSections, type MenuEntry, type SectionStatus } from "@/lib/command-menu";
import { KeyCaps, useCommandRegistry } from "./commands";

type MenuEvent = { name: string; slug: string; eventType: "demo" | "hackathon"; phase?: EventPhase };
type PracticeRow = { name: string; slug: string; eventType: "demo" | "hackathon"; phase: EventPhase };
type Row = MenuEntry & { icon?: LucideIcon; run: () => void };

const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/** Real events offered before anything is typed, after the live one. */
const RECENT_EVENTS = 4;

/**
 * ⌘K: opens on the live event's places, recent events, creating and pages;
 * typing searches every registered command and the org's events, ranked in
 * fixed groups. Page actions and organization switching appear once you type.
 */
export function CommandMenu({ liveEvent, events, searchable }: {
  /** Undefined while loading, null when there is none. */
  liveEvent: MenuEvent | null | undefined;
  /** The org's real events loaded so far, newest first. */
  events?: MenuEvent[];
  /** Whether the menu may search the organization's events (an organization is chosen and loaded). */
  searchable: boolean;
}) {
  const { menuOpen, setMenuOpen } = useCommandRegistry();
  return <CommandDialog open={menuOpen} onOpenChange={setMenuOpen} title="Command menu" description="Search events, pages and actions" className="dq-command top-[12vh] gap-0 sm:max-w-[600px]">
    {/* Mounted only while open, so each opening starts on the suggestions. */}
    <MenuBody liveEvent={liveEvent} events={events ?? []} searchable={searchable} close={() => setMenuOpen(false)} />
  </CommandDialog>;
}

function MenuBody({ liveEvent, events, searchable, close }: { liveEvent: MenuEvent | null | undefined; events: MenuEvent[]; searchable: boolean; close: () => void }) {
  const { commands } = useCommandRegistry();
  const navigate = useInPageNavigate();
  const [query, setQuery] = useState("");
  const [practice, setPractice] = useState<PracticeRow[] | undefined | "error">(undefined);
  const onPracticeError = useCallback(() => setPractice("error"), []);
  const typed = query.trim().length > 0;

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = dedupeEntries(commands.map((command) => ({
      id: command.id, title: command.label, subtitle: command.hint, keywords: command.keywords, group: command.group,
      keys: command.keys, disabled: command.disabled, icon: command.icon, run: command.run,
    })));
    const open = (slug: string) => () => navigate(adminPath(slug));
    let recent = 0;
    for (const event of events) {
      const live = event.slug === liveEvent?.slug;
      const suggested = !live && recent < RECENT_EVENTS;
      if (suggested) recent += 1;
      const kind = event.eventType === "hackathon" ? "Hackathon" : "Demo night";
      const state = event.phase ? phaseTabLabel(event.eventType, event.phase) : undefined;
      list.push({
        id: `event-${event.slug}`, title: event.name, group: EVENTS_GROUP, suggested,
        subtitle: [live ? "Live" : kind, state].filter(Boolean).join(" · "), keywords: [event.slug, kind],
        icon: event.eventType === "hackathon" ? Code2 : Presentation, run: open(event.slug),
      });
    }
    if (Array.isArray(practice)) for (const event of practice) {
      list.push({
        id: `practice-${event.slug}`, title: event.name, group: EVENTS_GROUP,
        subtitle: `Practice · ${phaseTabLabel(event.eventType, event.phase)}`, keywords: [event.slug, "practice"],
        icon: FlaskConical, run: open(event.slug),
      });
    }
    return list;
  }, [commands, events, practice, liveEvent?.slug, navigate]);

  const status: Record<string, SectionStatus | undefined> = {};
  if (searchable && liveEvent === undefined) status[LIVE_GROUP] = "loading";
  if (searchable && typed && practice === undefined) status[EVENTS_GROUP] = "loading";
  if (searchable && typed && practice === "error") status[EVENTS_GROUP] = "error";
  const sections = menuSections(query, rows, status);
  const resultCount = sections.reduce((total, section) => total + section.entries.length, 0);
  const pending = sections.some((section) => section.status === "loading");
  // The best match is selected as results change; arrows and hover move it from
  // there. cmdk picks the first row itself after the search or the rows change,
  // so only a move the person made counts, and any other pick is put back by
  // passing the value again (cmdk trims the trailing space, so it is the same row).
  const [picked, setPicked] = useState<{ query: string; id: string } | null>(null);
  const selected = picked?.query === query ? picked.id : bestEntryId(query, sections) ?? "";
  const [resync, setResync] = useState(0);
  const value = resync % 2 ? `${selected} ` : selected;
  const moving = useRef(false);
  const onSelectionChange = (id: string) => {
    if (moving.current) setPicked({ query, id });
    else if (id !== selected) setResync((count) => count + 1);
    moving.current = false;
  };
  const onInputKeyDown = (event: KeyboardEvent) => {
    if (MOVE_KEYS.has(event.key) || (event.ctrlKey && "npjk".includes(event.key.toLowerCase()))) moving.current = true;
  };

  const run = (row: Row) => { close(); row.run(); };

  return <>
    {searchable && <PracticeBoundary onError={onPracticeError}><PracticeSource onChange={setPractice} /></PracticeBoundary>}
    <CommandRoot shouldFilter={false} loop value={value} onValueChange={onSelectionChange} onKeyDown={onInputKeyDown} onPointerMoveCapture={() => { moving.current = true; }} className="dq-command-root">
      <CommandInput value={query} onValueChange={(next) => { moving.current = false; setQuery(next); }} placeholder="Search events, pages and actions…" />
      <CommandList className="dq-command-list">
        {sections.map((section) => <CommandGroup key={section.group} heading={<SectionHeading group={section.group} typed={typed} />}>
          {section.entries.map((row) => <CommandItem key={row.id} value={row.id} disabled={row.disabled} onSelect={() => run(row)}>
            <RowIcon icon={row.icon} />
            <span className="dq-command-title">{row.title}</span>
            <CommandShortcut className="dq-command-meta">
              {row.subtitle && <span className="dq-command-hint">{row.subtitle}</span>}
              {row.keys && <KeyCaps keys={row.keys} />}
            </CommandShortcut>
          </CommandItem>)}
          {section.status === "loading" && <div className="dq-command-placeholder" aria-hidden>
            {[0, 1].map((key) => <div key={key} className="dq-command-placeholder-row"><Skeleton className="size-4 rounded" /><Skeleton className="h-3 w-40" /></div>)}
          </div>}
          {section.status === "error" && <p className="dq-command-error">Couldn’t load practice events. Close the menu and open it again to retry.</p>}
        </CommandGroup>)}
        {typed && resultCount === 0 && !pending && <div className="dq-command-empty">
          <p>No matches for “{query.trim()}”</p>
          <p className="dq-secondary">Searched pages, actions and {searchable ? "your organization’s events" : "this workspace"}.</p>
        </div>}
      </CommandList>
      <div role="status" aria-live="polite" className="sr-only">{pending ? "Loading" : typed ? `${resultCount} results` : ""}</div>
    </CommandRoot>
    <footer className="dq-command-footer" aria-hidden>
      <span><Kbd>↑</Kbd><Kbd>↓</Kbd>Move</span>
      <span><Kbd>↵</Kbd>Open</span>
      <span><Kbd>esc</Kbd>Close</span>
      <span className="ml-auto"><Kbd>?</Kbd>All shortcuts</span>
    </footer>
  </>;
}

function SectionHeading({ group, typed }: { group: string; typed: boolean }) {
  if (isLiveGroup(group)) return <span className="dq-command-heading"><span className="dq-dot" data-tone={group === LIVE_GROUP ? undefined : "success"} aria-hidden />{group}</span>;
  if (group === EVENTS_GROUP && !typed) return <span className="dq-command-heading">Recent events</span>;
  return <span className="dq-command-heading">{group}</span>;
}

function RowIcon({ icon: Icon = Zap }: { icon?: LucideIcon }) {
  return <Icon aria-hidden className="dq-command-icon" />;
}

/** Practice events load only while the menu is open; a failure stays inside the Events group. */
function PracticeSource({ onChange }: { onChange: (rows: PracticeRow[] | undefined) => void }) {
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.practice.listPracticeEvents, isAuthenticated ? {} : "skip");
  useEffect(() => { onChange(rows); }, [rows, onChange]);
  return null;
}

class PracticeBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
