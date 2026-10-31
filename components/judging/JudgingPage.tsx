"use client";

import { Component, memo, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Check, ChevronDown, FileSpreadsheet, RotateCcw, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { teamShortLabel, type SubmissionPreview } from "@/components/SubmissionPreviewCard";
import type { AdminData } from "@/components/live/PhaseTabs";
import { JudgesCard } from "@/components/live/JudgeTools";
import { Toggle } from "@/components/live/Toggle";
import { EventTabActionsContext } from "@/components/live/EventTabs";
import { JUDGING_VIEWS, judgingPath, parseJudgingView, type JudgingView } from "@/lib/admin-views";
import { JUDGING_CRITERION_LABELS } from "@/lib/judging-rubric";
import { CRITERIA, judgeInitials, parseReviewGroup, rankRows, type JudgeChip, type RankSort } from "@/lib/judging-board";
import { ProgressView, RankingView } from "./ProjectRows";
import { FinalistsView } from "./FinalistsView";
import { ClockCard, DetailPanel } from "./JudgingSide";
import styles from "./judging.module.css";
import { InPageLink } from "@/components/InPageLink";

export type Preview = SubmissionPreview & { tracks: string[] };

/** One project as every Judging view shows it. */
export type BoardRow = {
  id: string;
  submissionId: Id<"submissions">;
  title: string;
  /** "Sam Lee +2": the presenter and how many others; the full team is in the preview card. */
  team: string;
  /** Every name on the team, for search. */
  people: string;
  tracks: string[];
  chips: JudgeChip[];
  completeReviews: number;
  assignedCount: number;
  preview: Preview | undefined;
};

/** The track filter value for projects that entered no track. */
export const MAIN_EVENT = "__main";

export type JudgingPageProps = {
  slug: string;
  admin: AdminData;
  previews: ReadonlyMap<string, Preview>;
  onHide: (id: Id<"submissions">) => Promise<void>;
  onManageJudges: () => void;
  sheetUrl?: string;
  sheetBusy: boolean;
  sheetSyncPending: boolean;
  sheetStatus: string;
  sheetMessage: string;
  onCreateSheet: () => void;
  onSyncSheet: () => void;
};

/**
 * Judging: Progress (who still needs scores), Ranking (the live order, with
 * evening out) and Finalists (the decision), with the clock and the judges
 * beside them. The view, filters, open project and open judge are in the
 * address, so a reload or a shared link lands on the same thing.
 */
export const JudgingPage = memo(function JudgingPage(props: JudgingPageProps) {
  return <JudgingBoundary><JudgingPageInner {...props} /></JudgingBoundary>;
});

function JudgingPageInner({ slug, admin, previews, onHide, onManageJudges, sheetUrl, sheetBusy, sheetSyncPending, sheetStatus, sheetMessage, onCreateSheet, onSyncSheet }: JudgingPageProps) {
  const sheet = { url: sheetUrl, busy: sheetBusy, syncPending: sheetSyncPending, status: sheetStatus, message: sheetMessage, onCreate: onCreateSheet, onSync: onSyncSheet };
  const pathname = usePathname();
  const search = useSearchParams();
  const view = parseJudgingView(search.get("judging"));
  const projectId = search.get("project");
  const track = search.get("track");
  const group = parseReviewGroup(search.get("group"));
  const judgeKey = search.get("judge");
  const sort = (["final", ...CRITERIA] as RankSort[]).find((item) => item === search.get("sort")) ?? "final";
  const showTracks = search.get("tracks") !== "0";
  const query = search.get("q") ?? "";

  const progress = useQuery(api.judging.getAdminProgress, { slug });
  const overview = useQuery(api.judging.getJudgesOverview, { slug });
  const normalization = useQuery(api.judging.getNormalizationOverview, { slug });
  const closed = admin.event.judgingStatus === "closed";

  /**
   * Changes only the given params; the rest of the address stays. This is
   * view state, so it goes through history.replaceState, which Next keeps in
   * step with useSearchParams. router.replace would fetch the page from the
   * server on every call, and the search box calls this as you type.
   */
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const next = params.toString();
    window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
  }, [pathname]);
  // Opening the open project closes it. Stable, so memoized rows don't re-render when another row is picked.
  const selectProject = useCallback((id: string) => {
    setParams({ project: new URLSearchParams(window.location.search).get("project") === id ? null : id });
  }, [setParams]);

  // The box shows each letter at once; the list filters at low priority, and the
  // address catches up once typing pauses.
  const [draft, setDraft] = useState(query);
  const typed = useDeferredValue(draft);
  const writeQuery = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onType = (value: string) => {
    setDraft(value);
    if (writeQuery.current) clearTimeout(writeQuery.current);
    writeQuery.current = setTimeout(() => setParams({ q: value }), 300);
  };
  useEffect(() => () => { if (writeQuery.current) clearTimeout(writeQuery.current); }, []);

  // Before judging closes, evening out is a view preference (`raw=1` turns it off).
  // After, it is the saved per-judge decision.
  const decisions = useMemo(() => new Map((normalization?.judges ?? []).map((judge) => [judge.judgeKey, judge])), [normalization]);
  const contributing = (normalization?.judges ?? []).filter((judge) => judge.completeReviewCount > 0);
  const evenOut = closed ? contributing.length === 0 || contributing.every((judge) => judge.effectiveDecision !== "raw") : search.get("raw") !== "1";

  // Same names as the Judges card, so a chip's initials match the judge beside it
  const judgeLabels = useMemo(() => judgeInitials([...(overview?.judges ?? []).map((judge) => judge.judgeName), ...(progress?.scoring ?? []).flatMap((row) => row.assignedJudges)]), [overview, progress]);
  const rows = useMemo<BoardRow[]>(() => {
    if (!progress) return [];
    const reviews = new Map(progress.reviews.map((review) => [`${String(review.submissionId)}:${review.judgeKey}`, review]));
    return progress.scoring.map((row) => {
      const id = String(row.submissionId);
      const preview = previews.get(id);
      // Keys and names line up: a judge is their key, the name is only shown.
      const chips = row.assignedJudgeKeys.map((key, index): JudgeChip => {
        const judgeName = row.assignedJudges[index] ?? key;
        const review = reviews.get(`${id}:${key}`);
        const judge = decisions.get(key);
        const normalized = judge?.reviews.find((item) => String(item.submissionId) === id);
        const applies = closed ? judge?.effectiveDecision !== "raw" : true;
        return {
          judgeKey: key,
          judgeName,
          initials: judgeLabels.get(judgeName) ?? "?",
          scores: review ? { innovation: review.innovation, execution: review.execution, demoClarity: review.demoClarity } : null,
          completed: review?.completed ?? false,
          evenedOut: normalized && applies ? normalized.clamped : null,
        };
      });
      return {
        id, submissionId: row.submissionId, title: row.demoTitle,
        team: preview ? teamShortLabel(preview) || row.presenterName : row.presenterName,
        people: preview ? preview.people.map((person) => person.name).join(" ") : row.presenterName,
        tracks: preview?.tracks ?? row.tracks, chips, completeReviews: row.completeReviewCount, assignedCount: row.assignedJudges.length, preview,
      };
    });
  }, [progress, previews, decisions, closed, judgeLabels]);

  const ranked = useMemo(() => rankRows(rows, evenOut, sort), [rows, evenOut, sort]);
  const visible = useMemo(() => {
    const needle = typed.trim().toLocaleLowerCase("en");
    return ranked.filter((row) => {
      if (track === MAIN_EVENT ? row.tracks.length > 0 : track && !row.tracks.includes(track)) return false;
      return !needle || [row.title, row.people].some((value) => value.toLocaleLowerCase("en").includes(needle));
    });
  }, [ranked, typed, track]);
  const selected = projectId ? ranked.find((row) => row.id === projectId) ?? null : null;
  const titleById = useMemo(() => new Map(rows.map((row) => [row.id, row.title])), [rows]);
  const loading = progress === undefined;
  const totals = overview?.totals;

  const filters = <>
    <label className={styles.search}><Search aria-hidden /><span className="sr-only">Find a project</span><input type="search" placeholder="Find a project" value={draft} onChange={(event) => onType(event.currentTarget.value)} /></label>
    <TrackMenu tracks={admin.tracks.map((item) => item.name)} value={track} onChange={(value) => setParams({ track: value })} />
  </>;
  const filtered = Boolean(typed || track);
  const clearFilters = () => {
    if (writeQuery.current) clearTimeout(writeQuery.current);
    setDraft("");
    setParams({ q: null, track: null });
  };

  const toolbar = <div className={styles.toolbar}>
    <div role="tablist" aria-label="Judging views" className="dq-segmented">
      {JUDGING_VIEWS.map((item) => <InPageLink key={item.view} role="tab" aria-selected={item.view === view} href={judgingPath(slug, { judging: item.view, track })} replace scroll={false}>{item.label}</InPageLink>)}
    </div>
    <span className={styles.toolbarFill} />
    {view === "ranking" && <span className={styles.evenOut}>
      <Toggle label="Even out strict and generous judges" checked={evenOut} disabled={closed && contributing.length === 0}
        onChange={async (on) => { if (!closed) { setParams({ raw: on ? null : "1" }); return; } await setEvenOut(on); }} />
    </span>}
    {view !== "finalists" && filters}
    {view !== "finalists" && <DisplayMenu view={view} sort={sort} showTracks={showTracks} onSort={(value) => setParams({ sort: value === "final" ? null : value })} onTracks={(on) => setParams({ tracks: on ? null : "0" })} />}
  </div>;

  const saveNormalization = useNormalizationSaver(slug);
  async function setEvenOut(on: boolean) {
    await saveNormalization(contributing.map((judge) => judge.judgeKey), on ? "apply" : "raw");
  }

  if (view === "finalists") return <>
    <SheetControls sheet={sheet} />
    <FinalistsView slug={slug} closed={closed} rows={ranked} visibleRows={visible} loading={loading} toolbar={toolbar} filters={filters} filtered={filtered} onClearFilters={clearFilters} />
  </>;

  return <div className={styles.page}>
    <SheetControls sheet={sheet} />
    <div className={styles.main}>
      {toolbar}
      {view === "progress" && <ProgressView rows={visible} loading={loading} group={group} assigned={(progress?.scoring ?? []).some((row) => row.assignedJudges.length > 0)} showTracks={showTracks}
        selectedId={projectId} onSelect={selectProject} onShowAll={() => setParams({ group: null })} filtered={filtered} onClearFilters={clearFilters} />}
      {view === "ranking" && <RankingView rows={visible} loading={loading} evenOut={evenOut} closed={closed} showTracks={showTracks} sort={sort}
        selectedId={projectId} onSelect={selectProject} filtered={filtered} onClearFilters={clearFilters} />}
    </div>
    {<aside className={styles.side} aria-label={selected ? `${selected.title} details` : "Clock and judges"}>
      {selected ? <DetailPanel slug={slug} row={selected} closed={closed} evenOut={evenOut} decisions={decisions}
          onClose={() => setParams({ project: null })} onHide={onHide} saveNormalization={saveNormalization} />
        : <>
          <ClockCard slug={slug} admin={admin} totals={totals} judges={overview?.judges} onManageJudges={onManageJudges} />
          <JudgesCard slug={slug} eventName={admin.event.name} overview={overview} openKey={judgeKey} onOpen={(key) => setParams({ judge: key })} onManage={onManageJudges} titleById={titleById} />
        </>}
    </aside>}
  </div>;
}

function useNormalizationSaver(slug: string) {
  const save = useMutation(api.judging.saveNormalizationDecision);
  return useCallback(async (judgeKeys: string[], decision: "apply" | "raw") => {
    for (const judgeKey of judgeKeys) await save({ slug, judgeKey, decision });
  }, [save, slug]);
}

function TrackMenu({ tracks, value, onChange }: { tracks: string[]; value: string | null; onChange: (value: string | null) => void }) {
  const label = value === MAIN_EVENT ? "Main event only" : value ?? "all";
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Track: {label}<ChevronDown aria-hidden /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(next) => onChange(String(next) || null)}>
        <DropdownMenuRadioItem value="">All tracks</DropdownMenuRadioItem>
        {tracks.map((name) => <DropdownMenuRadioItem key={name} value={name}>{name}</DropdownMenuRadioItem>)}
        <DropdownMenuRadioItem value={MAIN_EVENT}>Main event only</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function DisplayMenu({ view, sort, showTracks, onSort, onTracks }: { view: JudgingView; sort: RankSort; showTracks: boolean; onSort: (value: RankSort) => void; onTracks: (on: boolean) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Display<ChevronDown aria-hidden /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52">
      {view === "ranking" && <><DropdownMenuGroup>
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(next) => onSort(next as RankSort)}>
          <DropdownMenuRadioItem value="final">Final score</DropdownMenuRadioItem>
          {CRITERIA.map((criterion) => <DropdownMenuRadioItem key={criterion} value={criterion}>{JUDGING_CRITERION_LABELS[criterion]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup><DropdownMenuSeparator /></>}
      <DropdownMenuCheckboxItem checked={showTracks} onCheckedChange={(checked) => onTracks(Boolean(checked))}>Show tracks</DropdownMenuCheckboxItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Create or open the judging sheet, and sync it: at the right of the event tabs, as drawn. */
function SheetControls({ sheet }: { sheet: { url?: string; busy: boolean; syncPending: boolean; status: string; message: string; onCreate: () => void; onSync: () => void } }) {
  const slot = useContext(EventTabActionsContext);
  const controls = <span className={styles.sheet}>
    {(sheet.message || sheet.status) && <span className={styles.sheetStatus} role="status">{sheet.message || sheet.status}</span>}
    {sheet.url ? <>
      <Button variant="ghost" size="sm" onClick={sheet.onSync} disabled={sheet.busy || sheet.syncPending}><RotateCcw aria-hidden />{sheet.syncPending ? "Syncing…" : "Sync now"}</Button>
      <Button variant="outline" size="sm" render={<a href={sheet.url} target="_blank" rel="noreferrer" />} nativeButton={false}><FileSpreadsheet aria-hidden />Open judging sheet</Button>
    </> : <Button variant="outline" size="sm" onClick={sheet.onCreate} disabled={sheet.busy}><FileSpreadsheet aria-hidden />{sheet.busy ? "Creating sheet…" : "Create judging sheet"}</Button>}
  </span>;
  return slot ? createPortal(controls, slot) : controls;
}

/** A failed judging query shows a retry instead of taking the admin page down. */
export class JudgingBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
    return <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">
      <span>Could not load judging. Scores are safe; this is only the page.</span>
      <Button variant="outline" size="sm" onClick={() => this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))}><Check aria-hidden />Retry</Button>
    </AlertDescription></Alert>;
  }
}
