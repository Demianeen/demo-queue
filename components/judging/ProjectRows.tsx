"use client";

import { useState } from "react";
import { ArrowDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SubmissionPreviewTrigger } from "@/components/SubmissionPreviewCard";
import { TrackChips } from "@/components/live/LiveEventHome";
import { JUDGING_CRITERION_LABELS } from "@/lib/judging-rubric";
import { CRITERIA, initials, REVIEW_GROUPS, REVIEW_TARGET, reviewGroup, scoreAverage, type JudgeChip, type RankedRow, type RankSort, type ReviewGroup } from "@/lib/judging-board";
import type { BoardRow } from "./JudgingPage";
import styles from "./judging.module.css";

const GROUP_PREVIEW = 5;
const RANKING_PREVIEW = 10;

/** "8.42", or a dash with no score yet. */
export function formatScore(value: number | null, digits = 2) {
  return value === null ? "–" : value.toFixed(digits);
}

/** The judge's name and their labelled scores, as the chip's tooltip and the detail panel say them. */
export function chipDescription(chip: JudgeChip) {
  if (!chip.scores || CRITERIA.every((criterion) => chip.scores?.[criterion] === undefined)) return "Not reviewed yet";
  return CRITERIA.map((criterion) => `${JUDGING_CRITERION_LABELS[criterion]} ${chip.scores?.[criterion] ?? "–"}`).join(" · ");
}

function ChipTip({ chip, children, className }: { chip: JudgeChip | null; children: React.ReactNode; className: string }) {
  return <Tooltip>
    <TooltipTrigger delay={120} render={<span tabIndex={0} />} className={className}>{children}</TooltipTrigger>
    <TooltipContent className={styles.tip}>
      {chip ? <span className={styles.tipBody}><strong>{chip.judgeName}</strong>{chip.scores && CRITERIA.some((criterion) => chip.scores?.[criterion] !== undefined)
        ? CRITERIA.map((criterion) => <span key={criterion} className={styles.tipLine}><span>{JUDGING_CRITERION_LABELS[criterion]}</span><b>{chip.scores?.[criterion] ?? "–"}</b></span>)
        : <span>Not reviewed yet</span>}{chip.scores && !chip.completed ? <span className={styles.tipNote}>Still scoring</span> : null}</span> : "Not reviewed yet"}
    </TooltipContent>
  </Tooltip>;
}

/** Progress: a judge's initials and their average, or a dashed chip until they score. */
function AverageChip({ chip }: { chip: JudgeChip | null }) {
  const average = chip?.completed ? scoreAverage(chip.scores) : null;
  if (!chip || (!chip.completed && !chip.scores)) return <ChipTip chip={chip} className={styles.chipEmpty}><span className="sr-only">{chip ? `${chip.judgeName}: not reviewed yet` : "Not reviewed yet"}</span></ChipTip>;
  return <ChipTip chip={chip} className={styles.chip} >
    <span className={styles.chipInitials} aria-hidden>{initials(chip.judgeName)}</span>
    <span className="dq-mono">{average === null ? "…" : average.toFixed(1)}</span>
    <span className="sr-only">{chip.judgeName}: {chipDescription(chip)}</span>
  </ChipTip>;
}

/** Ranking: a judge's initials and their three scores as entered, under the I E D header. */
export function CriteriaChip({ chip }: { chip: JudgeChip | null }) {
  if (!chip || !chip.scores) return <ChipTip chip={chip} className={styles.chipEmptyWide}><span className="sr-only">{chip ? `${chip.judgeName}: not reviewed yet` : "Not reviewed yet"}</span></ChipTip>;
  return <ChipTip chip={chip} className={styles.chipWide} >
    <span className={styles.chipInitials} aria-hidden>{initials(chip.judgeName)}</span>
    {CRITERIA.map((criterion) => <span key={criterion} className={`dq-mono ${styles.digit}`} aria-hidden>{chip.scores?.[criterion] ?? "–"}</span>)}
    <span className="sr-only">{chip.judgeName}: {chipDescription(chip)}</span>
  </ChipTip>;
}

export function slots(row: BoardRow, count: number) {
  return Array.from({ length: Math.max(count, row.chips.length) }, (_, index) => row.chips[index] ?? null);
}

/** I E D over each chip's digits, with no "Judges" label: the initials already say so. Hover a letter for its criterion. */
export function CriteriaHeader({ slotCount }: { slotCount: number }) {
  return <span className={styles.chips} role="columnheader" aria-label="Judges' scores: innovation, execution, demo clarity">
    {Array.from({ length: slotCount }, (_, index) => <span key={index} className={styles.letters}>
      {CRITERIA.map((criterion) => <Tooltip key={criterion}>
        <TooltipTrigger delay={120} render={<span tabIndex={0} />} className={styles.letter}>{JUDGING_CRITERION_LABELS[criterion][0]}</TooltipTrigger>
        <TooltipContent side="bottom">{JUDGING_CRITERION_LABELS[criterion]}</TooltipContent>
      </Tooltip>)}
    </span>)}
  </span>;
}

function StatusIcon({ completeReviews }: { completeReviews: number }) {
  const group = reviewGroup(completeReviews);
  return <span className={styles.status} data-group={group} aria-label={group === "done" ? "Fully reviewed" : `${completeReviews} of ${REVIEW_TARGET} reviews`}>{group === "done" ? <Check aria-hidden /> : null}</span>;
}

function RowsSkeleton({ count = 5 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div key={index} className={styles.row} aria-hidden><Skeleton className="size-3.5 rounded-full" /><Skeleton className="h-3 w-40" /><Skeleton className="ml-auto h-5 w-24 rounded-full" /><Skeleton className="h-3 w-10" /></div>)}</>;
}

function Empty({ filtered, onClearFilters, children }: { filtered: boolean; onClearFilters: () => void; children: React.ReactNode }) {
  return <div className={styles.empty}>{filtered ? <>No projects match. <Button variant="link" size="sm" onClick={onClearFilters}>Clear the search and track</Button></> : children}</div>;
}

/**
 * Progress: projects grouped by how many reviews they still need, each with
 * one chip per judge. Opening a group from the Overview's counts shows only
 * that group (`&group=`).
 */
export function ProgressView({ rows, loading, group, assigned, showTracks, selectedId, onSelect, onShowAll, filtered, onClearFilters }: {
  rows: RankedRow<BoardRow>[]; loading: boolean; group: ReviewGroup | null; assigned: boolean; showTracks: boolean;
  selectedId: string | null; onSelect: (id: string) => void; onShowAll: () => void; filtered: boolean; onClearFilters: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<ReviewGroup>>(new Set());
  const groups = REVIEW_GROUPS.filter((item) => !group || item.group === group);
  const byTitle = [...rows].sort((left, right) => left.title.localeCompare(right.title));
  return <div className={styles.listWrap}>
    {group && <div className={styles.filterBar}>Showing only <strong>{REVIEW_GROUPS.find((item) => item.group === group)?.label.toLowerCase()}</strong><Button variant="link" size="sm" onClick={onShowAll}>Show all projects</Button></div>}
    <div className={`dq-card ${styles.list}`}>
      {loading ? <><div className={styles.groupHead}><Skeleton className="h-3 w-36" /></div><RowsSkeleton /></>
        : rows.length === 0 ? <Empty filtered={filtered} onClearFilters={onClearFilters}>No projects in judging yet. Queued and waiting projects join judging; hidden and withdrawn ones don&apos;t.</Empty>
        : groups.map((item) => {
          const members = byTitle.filter((row) => reviewGroup(row.completeReviews) === item.group);
          const open = Boolean(group) || expanded.has(item.group);
          const shown = open ? members : members.slice(0, GROUP_PREVIEW);
          return <section key={item.group} aria-label={item.label}>
            <h3 className={styles.groupHead}>{item.label}<span className={styles.count}>{members.length}</span></h3>
            {members.length === 0 && <p className={styles.groupEmpty}>{item.group === "done" ? "None yet." : "None. Nice."}</p>}
            {shown.map((row) => <div key={row.id} className={styles.row} data-selected={row.id === selectedId ? "" : undefined} onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button:not([data-select]), [role=dialog]")) onSelect(row.id); }}>
              <button type="button" data-select="" className={styles.selectButton} aria-label={`Open ${row.title}`} aria-pressed={row.id === selectedId}><StatusIcon completeReviews={row.completeReviews} /></button>
              <span className={styles.title}>{row.preview ? <SubmissionPreviewTrigger preview={row.preview} className={styles.titleTrigger} /> : row.title}<span className={styles.team}>{row.team}</span></span>
              {showTracks && <span className={styles.tracks}><TrackChips tracks={row.tracks} /></span>}
              <span className={styles.chips}>{slots(row, REVIEW_TARGET).map((chip, index) => <AverageChip key={chip?.judgeKey ?? `empty-${index}`} chip={chip} />)}</span>
              <span className={`dq-mono ${styles.final}`}>{formatScore(row.final)}</span>
            </div>)}
            {!open && members.length > GROUP_PREVIEW && <button type="button" className={styles.more} onClick={() => setExpanded((current) => new Set(current).add(item.group))}>{members.length - GROUP_PREVIEW} more</button>}
          </section>;
        })}
    </div>
    <p className={styles.footnote}>{assigned
      ? `Every project needs ${REVIEW_TARGET} reviews. Assignments are automatic, so there is nothing to hand out. Each chip is one judge's score; hover it for their scores. Hover a project name for its video, links, AI summary and team.`
      : "Projects get two judges each when you assign them, after submissions close. Hover a project name for its video, links, AI summary and team."}</p>
  </div>;
}

/**
 * Ranking: the live order. Each chip is one judge's scores as they entered
 * them under I, E and D; Final evens out strict and generous judges unless
 * that is turned off.
 */
export function RankingView({ rows, loading, evenOut, closed, showTracks, sort, selectedId, onSelect, filtered, onClearFilters }: {
  rows: RankedRow<BoardRow>[]; loading: boolean; evenOut: boolean; closed: boolean; showTracks: boolean; sort: RankSort;
  selectedId: string | null; onSelect: (id: string) => void; filtered: boolean; onClearFilters: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, RANKING_PREVIEW);
  const slotCount = Math.max(REVIEW_TARGET, ...rows.map((row) => row.chips.length));
  return <div className={styles.listWrap}>
    <div className={`dq-card ${styles.list}`} role="table" aria-label="Ranking">
      <div className={styles.rankHead} role="row">
        <span className={styles.rank} role="columnheader">#</span>
        <span className={styles.title} role="columnheader">Project</span>
        {showTracks && <span className={`sr-only ${styles.tracks}`} role="columnheader">Tracks</span>}
        <CriteriaHeader slotCount={slotCount} />
        <span className={styles.final} role="columnheader" aria-sort={sort === "final" ? "descending" : undefined}>Final{sort === "final" && <ArrowDown aria-hidden />}</span>
      </div>
      {loading ? <RowsSkeleton count={6} />
        : rows.length === 0 ? <Empty filtered={filtered} onClearFilters={onClearFilters}>No projects in judging yet.</Empty>
        : shown.map((row) => <div key={row.id} role="row" className={styles.row} data-selected={row.id === selectedId ? "" : undefined} onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button:not([data-select]), [role=dialog]")) onSelect(row.id); }}>
          <span role="cell" className={styles.rank}><button type="button" data-select="" className={styles.selectButton} aria-label={`Open ${row.title}, ranked ${row.rank}`} aria-pressed={row.id === selectedId}>{row.rank}</button></span>
          <span role="cell" className={styles.title}>{row.preview ? <SubmissionPreviewTrigger preview={row.preview} className={styles.titleTrigger} /> : row.title}<span className={styles.team}>{row.team}</span></span>
          {showTracks && <span role="cell" className={styles.tracks}><TrackChips tracks={row.tracks} /></span>}
          <span role="cell" className={styles.chips}>{slots(row, slotCount).map((chip, index) => <CriteriaChip key={chip?.judgeKey ?? `empty-${index}`} chip={chip} />)}</span>
          <span role="cell" className={`dq-mono ${styles.final}`} title={evenOut && row.final !== null && row.rawFinal !== null && Math.abs(row.final - row.rawFinal) >= 0.005 ? `Raw ${row.rawFinal.toFixed(2)}` : undefined}>{formatScore(row.final)}</span>
        </div>)}
      {!loading && !all && rows.length > RANKING_PREVIEW && <button type="button" className={styles.more} onClick={() => setAll(true)}>{rows.length - RANKING_PREVIEW} more</button>}
    </div>
    <p className={styles.footnote}>{closed ? "Judging is closed, so this is the final order." : "Live while judging runs."} Each chip is one judge&apos;s scores as they entered them: I innovation, E execution, D demo clarity. Hover a chip for the judge&apos;s name and labelled scores, or a letter for its criterion. {evenOut ? "Final evens out judges who score high or low across the board; turn that off to rank by raw scores." : "Final is the raw average of complete reviews."} Tracks and sorting by one criterion are in Display.</p>
  </div>;
}
