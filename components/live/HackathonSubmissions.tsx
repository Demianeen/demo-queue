"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MoreHorizontal, Search, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SubmissionPreviewBody, type SubmissionPreview } from "@/components/SubmissionPreviewCard";
import { SubmissionRowActions } from "@/components/SubmissionRowActions";
import { useCommands, type Command } from "@/components/shell/commands";
import { useFinalists, type AdminData } from "./PhaseTabs";
import styles from "./live.module.css";

/** One submission as the Submissions list needs it. */
export type ListedSubmission = {
  id: Id<"submissions">;
  name: string;
  demoTitle: string;
  description: string;
  email?: string;
  teamName?: string;
  teamMembers: string[];
  tracks: string[];
  trackIds: Id<"eventTracks">[];
  status: string;
  hidden: boolean;
  /** "Waiting", or where it is now: "Now", "#3", "Pitched", "No-show". */
  statusLabel: string;
};

type Group = "waiting" | "withdrawn" | "hidden";
const GROUPS: { id: Group; label: string; note?: string }[] = [
  { id: "waiting", label: "Waiting" },
  { id: "withdrawn", label: "Withdrawn" },
  { id: "hidden", label: "Hidden", note: "frees its emails" },
];
const SHOWN = 50;

function groupOf(item: ListedSubmission): Group {
  return item.hidden ? "hidden" : item.status === "withdrawn" ? "withdrawn" : "waiting";
}

function teamLabel(item: ListedSubmission) {
  return item.teamMembers.length > 0 ? `${item.name} +${item.teamMembers.length}` : item.name;
}

/**
 * A hackathon's Submissions: grouped by status (Waiting, then Withdrawn and
 * Hidden when there are some), with search and filters in the address and
 * the open project, with everyone's contacts, in a side panel. J and K move,
 * Enter opens, E edits and H hides.
 */
export function HackathonSubmissions({ slug, admin, items, tracks, previewFor, contactFor, editFormFor, editingId, surge, onEdit, onHide, onRestore, onAddTest, onClearAll, onShare }: {
  items: ListedSubmission[];
  tracks: { id: Id<"eventTracks">; name: string }[];
  slug: string;
  admin: AdminData;
  previewFor: (id: Id<"submissions">) => SubmissionPreview | null;
  contactFor: (id: Id<"submissions">) => ReactNode;
  editFormFor: (id: Id<"submissions">) => ReactNode;
  editingId: Id<"submissions"> | null;
  surge: ReactNode;
  onEdit: (id: Id<"submissions">) => void;
  onHide: (id: Id<"submissions">) => Promise<void>;
  onRestore: (id: Id<"submissions">) => Promise<void>;
  onAddTest: () => void;
  onClearAll: () => void;
  onShare: () => void;
}) {
  const pathname = usePathname();
  const finalists = useFinalists(slug, admin);
  // Finalist marks the ones picked and submitted in Judging.
  const finalistIds = useMemo(() => new Set(finalists?.decision.finalistStatus === "submitted" ? finalists.decision.finalistIds.map(String) : []), [finalists]);
  const searchParams = useSearchParams();
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const next = params.toString();
    window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
  }, [pathname]);

  // The box keeps its own text and writes the address once typing stops.
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  useEffect(() => {
    const timer = window.setTimeout(() => setParams({ q: search.trim() || null }), 300);
    return () => window.clearTimeout(timer);
  }, [search, setParams]);
  const status = (searchParams.get("status") ?? "all") as Group | "all";
  const track = searchParams.get("track") ?? "all";
  const openId = searchParams.get("project");
  const [expanded, setExpanded] = useState<Set<Group>>(new Set());

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => items.filter((item) => {
    if (status !== "all" && groupOf(item) !== status) return false;
    if (track === "none" ? item.trackIds.length > 0 : track !== "all" && !item.trackIds.some((id) => String(id) === track)) return false;
    if (!needle) return true;
    return [item.demoTitle, item.description, item.name, item.teamName ?? "", item.email ?? "", ...item.teamMembers].join(" ").toLowerCase().includes(needle);
  }), [items, status, track, needle]);
  const groups = GROUPS.map((group) => ({ ...group, rows: filtered.filter((item) => groupOf(item) === group.id) }))
    .filter((group) => group.id === "waiting" ? group.rows.length > 0 || filtered.length === 0 : group.rows.length > 0);
  const visible = groups.flatMap((group) => expanded.has(group.id) ? group.rows : group.rows.slice(0, SHOWN));

  const [cursor, setCursor] = useState<string | null>(null);
  const focusId = cursor && visible.some((item) => String(item.id) === cursor) ? cursor : openId;
  const open = openId ? items.find((item) => String(item.id) === openId) ?? null : null;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusId) listRef.current?.querySelector(`[data-row="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  const latest = useRef({ visible, focusId, open, onEdit, onHide, setParams });
  useEffect(() => { latest.current = { visible, focusId, open, onEdit, onHide, setParams }; });
  const commands = useMemo<Command[]>(() => {
    const move = (step: number) => {
      const { visible: rows, focusId: at } = latest.current;
      if (rows.length === 0) return;
      const index = rows.findIndex((item) => String(item.id) === at);
      const next = rows[Math.min(Math.max(index === -1 ? 0 : index + step, 0), rows.length - 1)];
      setCursor(String(next.id));
      if (latest.current.open) latest.current.setParams({ project: String(next.id) });
    };
    const target = () => latest.current.visible.find((item) => String(item.id) === latest.current.focusId) ?? latest.current.open;
    return [
      { id: "submissions-next", group: "This page", label: "Next submission", keys: ["J"], run: () => move(1) },
      { id: "submissions-previous", group: "This page", label: "Previous submission", keys: ["K"], run: () => move(-1) },
      { id: "submissions-open", group: "This page", label: "Open submission", hint: "Enter", run: () => { const item = target(); if (item) latest.current.setParams({ project: String(item.id) }); } },
      { id: "submissions-edit", group: "This page", label: "Edit submission", keys: ["E"], run: () => { const item = target(); if (item) { latest.current.setParams({ project: String(item.id) }); latest.current.onEdit(item.id); } } },
      { id: "submissions-hide", group: "This page", label: "Hide submission", keys: ["H"], run: () => { const item = target(); if (item && !item.hidden) void latest.current.onHide(item.id); } },
    ];
  }, []);
  useCommands("hackathon-submissions", commands);
  // Enter opens the row J and K moved to; the command keys only take letters.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, button, a, [role='dialog'], [role='menu'], [contenteditable]")) return;
      const { focusId: at, setParams: set } = latest.current;
      if (!at) return;
      event.preventDefault();
      set({ project: at });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearFilters = () => { setSearch(""); setParams({ q: null, status: null, track: null }); };

  return <div className={styles.subsLayout} data-open={open ? "" : undefined}>
    <div className={styles.subsMain}>
      {surge}
      <div className={styles.subsBar}>
        <label className={styles.subsSearch}>
          <Search aria-hidden />
          <span className="sr-only">Find a project, person or email</span>
          <input type="search" value={search} placeholder="Find a project, person or email" onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && search) { event.stopPropagation(); setSearch(""); } }} />
        </label>
        <label className={styles.subsFilter}><span>Status</span>
          <select value={status} onChange={(event) => setParams({ status: event.currentTarget.value === "all" ? null : event.currentTarget.value })}>
            <option value="all">all</option>
            {GROUPS.map((group) => <option key={group.id} value={group.id}>{group.label.toLowerCase()}</option>)}
          </select>
        </label>
        <label className={styles.subsFilter}><span>Track</span>
          <select value={track} onChange={(event) => setParams({ track: event.currentTarget.value === "all" ? null : event.currentTarget.value })}>
            <option value="all">all</option>
            {tracks.map((option) => <option key={option.id} value={String(option.id)}>{option.name}</option>)}
            <option value="none">no track</option>
          </select>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More submission actions" className="ml-auto" />}><MoreHorizontal aria-hidden /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddTest}>Add test submissions</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={items.length === 0} onClick={onClearAll}>Clear all…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {items.length === 0 ? <div className={styles.emptyCard}>
        <strong>No submissions yet</strong>
        <span>Share the submit link to get the first one.</span>
        <Button size="sm" variant="outline" onClick={onShare}>Share</Button>
      </div> : filtered.length === 0 ? <div className={styles.emptyCard}>
        <strong>No submissions match</strong>
        <span>{needle ? `Nothing matches “${search.trim()}”` : "Nothing matches these filters"}.</span>
        <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>
      </div> : <div ref={listRef} className={styles.subsTable} role="table" aria-label="Submissions">
        <div className={styles.subsHead} role="row">
          <span role="columnheader">Project</span><span role="columnheader">Team</span><span role="columnheader">Tracks</span><span role="columnheader">Contact</span><span role="columnheader"><span className="sr-only">Actions</span></span>
        </div>
        {groups.map((group) => {
          const rows = expanded.has(group.id) ? group.rows : group.rows.slice(0, SHOWN);
          return <Fragment key={group.id}>
            <div className={styles.subsGroup} role="row"><span role="rowheader">{group.label} <span className={styles.hint}>{group.rows.length}</span>{group.note ? <span className={styles.hint}> · {group.note}</span> : null}</span></div>
            {rows.map((item) => {
              const id = String(item.id);
              return <div key={id} role="row" data-row={id} className={styles.subsRow} data-open={openId === id ? "" : undefined} data-focus={focusId === id ? "" : undefined}>
                <span role="cell" className={styles.subsProject}>
                  <button type="button" onClick={() => { setCursor(id); setParams({ project: openId === id ? null : id }); }}>
                    {finalistIds.has(id) ? <span className="dq-track-chip" data-finalist="">Finalist</span> : null}
                    {item.statusLabel !== "Waiting" && !item.hidden && item.status !== "withdrawn" ? <span className="dq-track-chip">{item.statusLabel}</span> : null}
                    <strong>{item.demoTitle || "Untitled project"}</strong>
                  </button>
                  {item.description ? <span className={styles.listTeam}>{item.description}</span> : null}
                </span>
                <span role="cell" className={styles.subsCell} title={[item.name, ...item.teamMembers].join(", ")}>{teamLabel(item)}</span>
                <span role="cell" className={styles.subsCell}>{item.tracks.length === 0 ? "Main event" : item.tracks.length === 1 ? item.tracks[0] : `${item.tracks[0]} +${item.tracks.length - 1}`}</span>
                <span role="cell" className={styles.subsCell}>{item.email ? <a href={`mailto:${item.email}`}>{item.email}</a> : null}</span>
                <span role="cell">
                  <SubmissionRowActions menuLabel={`Options for ${item.demoTitle || item.name}`} menuItems={item.hidden || item.status === "withdrawn"
                    ? [{ label: "Edit", onSelect: () => { setParams({ project: id }); onEdit(item.id); } }, { label: "Restore", onSelect: () => void onRestore(item.id) }]
                    : [{ label: "Edit", onSelect: () => { setParams({ project: id }); onEdit(item.id); } }, { label: "Hide", onSelect: () => void onHide(item.id) }]} />
                </span>
              </div>;
            })}
            {group.rows.length > rows.length ? <div role="row" className={styles.subsGroup}><span role="cell">
              <button type="button" className={styles.linkButton} onClick={() => setExpanded((current) => new Set(current).add(group.id))}>{group.rows.length - rows.length} more</button>
            </span></div> : null}
          </Fragment>;
        })}
      </div>}
      <p className={styles.note}>J and K move, Enter opens, E edits, H hides.</p>
    </div>

    {open ? <SubmissionPanel key={String(open.id)} item={open} preview={previewFor(open.id)} contact={contactFor(open.id)}
      editing={editingId === open.id} editForm={editingId === open.id ? editFormFor(open.id) : null} finalist={finalistIds.has(String(open.id))}
      onClose={() => setParams({ project: null })} onEdit={() => onEdit(open.id)} onHide={() => onHide(open.id)} onRestore={() => onRestore(open.id)} /> : null}
  </div>;
}

function SubmissionPanel({ item, preview, contact, editing, editForm, finalist, onClose, onEdit, onHide, onRestore }: {
  item: ListedSubmission;
  preview: SubmissionPreview | null;
  contact: ReactNode;
  editing: boolean;
  editForm: ReactNode;
  finalist: boolean;
  onClose: () => void;
  onEdit: () => void;
  onHide: () => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const act = (action: () => Promise<void>) => { setBusy(true); void action().finally(() => setBusy(false)); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [role='dialog'], [role='menu']")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const restorable = item.hidden || item.status === "withdrawn";
  return <aside className={styles.room} aria-labelledby="submission-panel-title">
    <div className={styles.roomInner}>
      <div className={styles.roomHead}>
        <h2 id="submission-panel-title">{item.demoTitle || "Untitled project"}</h2>
        <span className={styles.hint}>{finalist ? "Finalist · " : ""}{item.hidden ? "Hidden" : item.status === "withdrawn" ? "Withdrawn" : item.statusLabel}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close the submission" onClick={onClose}><X aria-hidden /></Button>
      </div>
      {editing ? editForm : <>
        <div className={styles.roomLinks}>
          <Button variant="outline" size="sm" onClick={onEdit}>Edit <kbd className={styles.kbd}>E</kbd></Button>
          {restorable
            ? <Button variant="outline" size="sm" disabled={busy} onClick={() => act(onRestore)}>Restore</Button>
            : <Button variant="outline" size="sm" disabled={busy} onClick={() => act(onHide)}>Hide <kbd className={styles.kbd}>H</kbd></Button>}
        </div>
        {preview ? <SubmissionPreviewBody preview={preview} /> : null}
        <section className={`dq-card ${styles.sideCard}`} aria-labelledby="submission-contact">
          <div className={styles.sideHead}><h2 id="submission-contact">Contact</h2></div>
          {contact ?? <span className={styles.hint}>No contact details.</span>}
        </section>
      </>}
    </div>
  </aside>;
}
