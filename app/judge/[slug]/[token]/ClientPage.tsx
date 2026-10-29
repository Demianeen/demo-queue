"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useParams } from "next/navigation";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  ExternalLinkIcon,
  LockKeyholeIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { api } from "../../../../convex/_generated/api";
import { Skeleton } from "@/app/Skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShortcutTooltip } from "@/components/shell/commands";
import { JUDGING_CRITERIA, JUDGING_CRITERION_LABELS } from "@/lib/judging-rubric";
import { Id } from "../../../../convex/_generated/dataModel";
import { youtubeEmbedUrl } from "@/lib/video-embed";
import styles from "./judge.module.css";

type Workspace = FunctionReturnType<typeof api.judging.getJudgeWorkspace>;
type Project = Workspace["projects"][number];
type Criterion = (typeof JUDGING_CRITERIA)[number];
type ScoreState = Partial<Record<Criterion, number>>;
type Show = "yours" | "helpOut" | "scored" | "all";

const CRITERION_HELP: Record<Criterion, string> = {
  innovation: "Originality of the idea and how clearly it differs from existing solutions.",
  execution: "Quality, robustness, and completeness of the implementation.",
  demoClarity: "How effectively the demo communicates the product and its value.",
};

/** What each band of the 0 to 10 scale means. Most projects land between 4 and 7. */
export const SCORE_BANDS = [
  { from: 0, to: 2, name: "Missing", text: "Not shown, or doesn't work." },
  { from: 3, to: 4, name: "Weak", text: "Works in parts, or close to what exists." },
  { from: 5, to: 6, name: "Solid", text: "Does what it says, nothing surprising." },
  { from: 7, to: 8, name: "Strong", text: "Clearly good, small rough edges." },
  { from: 9, to: 10, name: "Exceptional", text: "Among the best you've seen tonight." },
] as const;

export function scoreBand(value: number) {
  return SCORE_BANDS.find((band) => value >= band.from && value <= band.to) ?? SCORE_BANDS[0];
}

const SHOW_OPTIONS: { value: Show; label: string; hint: string; key: string }[] = [
  { value: "yours", label: "Yours", hint: "Assigned to you, not scored yet", key: "1" },
  { value: "helpOut", label: "Help out", hint: "Other judges' projects still waiting for a second review", key: "2" },
  { value: "scored", label: "Scored", hint: "Ones you've scored, to change a score", key: "3" },
  { value: "all", label: "All", hint: "Every project in the event", key: "4" },
];

const GROUP_HEADINGS: Record<Show, string> = {
  yours: "Yours · assigned to you, not scored yet",
  helpOut: "Help out · other judges' projects still waiting for a second review",
  scored: "Scored · yours to change",
  all: "Every project",
};

const MAIN_EVENT = "main";

function scoreIsComplete(scores: ScoreState) {
  return JUDGING_CRITERIA.every((criterion) => scores[criterion] !== undefined);
}

function formatTimer(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

function useJudgingClock(timer: { remainingMs: number; serverNow: number; running: boolean } | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => { if (timer) setOffset(Date.now() - timer.serverNow); }, [timer?.serverNow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!timer?.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer?.running, timer?.serverNow, timer?.remainingMs]);
  if (!timer) return 0;
  return timer.running ? timer.remainingMs - (now - offset - timer.serverNow) : timer.remainingMs;
}

function genericVideoEmbedUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function Readme({ repositoryUrl }: { repositoryUrl: string | null }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; markdown: string }>({ status: "idle", markdown: "" });
  useEffect(() => {
    if (!repositoryUrl) { setState({ status: "idle", markdown: "" }); return; }
    const controller = new AbortController();
    setState({ status: "loading", markdown: "" });
    void fetch(`/api/github-readme?url=${encodeURIComponent(repositoryUrl)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("README unavailable");
        return await response.json() as { markdown: string };
      })
      .then((result) => setState({ status: "ready", markdown: result.markdown }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", markdown: "" });
      });
    return () => controller.abort();
  }, [repositoryUrl]);
  return (
    <section className={styles.readmeSection} id="project-readme">
      <div className={styles.sectionLabel}><BookOpenIcon /> README</div>
      {state.status === "loading" ? (
        <div className={styles.readmeLoading}><Skeleton w="58%" h={24} /><Skeleton h={14} /><Skeleton w="85%" h={14} /><Skeleton h={90} /></div>
      ) : state.status === "ready" ? (
        <div className={styles.markdown}><ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>{state.markdown}</ReactMarkdown></div>
      ) : (
        <p className={styles.emptyCopy}>{repositoryUrl ? "The README could not be displayed here. Open the repository to review it on GitHub." : "No GitHub repository was provided."}</p>
      )}
    </section>
  );
}

type AiSummary = NonNullable<Project["aiSummary"]>;

/** The summary comes first. While it is being written, or when none is coming, the judge is told so. */
function AiSummarySlot({ summary, status }: { summary: AiSummary | null; status: Project["aiSummaryStatus"] }) {
  if (summary) return <AiSummaryPanel summary={summary} />;
  if (status === "writing") {
    return (
      <section aria-labelledby="ai-summary-heading" aria-busy="true" className={styles.aiSummary}>
        <h2 className={styles.aiSummaryHeading} id="ai-summary-heading"><SparklesIcon aria-hidden="true" /> AI summary</h2>
        <div className={styles.aiSummaryPending}><Skeleton h={12} /><Skeleton w="86%" h={12} /><Skeleton w="72%" h={12} /></div>
        <p className={styles.aiSummaryNote}>Summary is being written. It appears here on its own.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="ai-summary-heading" className={styles.aiSummaryNone}>
      <h2 className={styles.aiSummaryHeading} id="ai-summary-heading"><SparklesIcon aria-hidden="true" /> No summary</h2>
      <p className={styles.aiSummaryNote}>There is no AI summary for this project. Use the description, the demo and the README.</p>
    </section>
  );
}

function AiSummaryPanel({ summary }: { summary: AiSummary }) {
  const rows: [string, string][] = [["What it does", summary.whatItDoes], ["How it works", summary.howItWorks], ["Look for in the demo", summary.demoFocus]];
  return (
    <section aria-labelledby="ai-summary-heading" className={styles.aiSummary}>
      <h2 className={styles.aiSummaryHeading} id="ai-summary-heading"><SparklesIcon aria-hidden="true" /> AI summary</h2>
      <dl className={styles.aiSummaryRows}>{rows.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
      <p className={styles.aiSummaryNote}>
        {`Written by AI from the team's description${summary.usedReadme ? " and README" : ""}. Check it against the demo.`}
        {summary.stale ? " The project changed since; a new summary is on its way." : null}
      </p>
    </section>
  );
}

function matchesSearch(project: Project, search: string) {
  if (!search) return true;
  return [project.demoTitle, project.name, project.teamName ?? "", ...project.tracks].some((value) => value.toLocaleLowerCase("en").includes(search));
}

function teamLine(project: Project) {
  if (!project.teamName) return project.name;
  return `${project.teamName} · ${project.memberCount} ${project.memberCount === 1 ? "member" : "members"}`;
}

function reviewNote(project: Project, target: number) {
  if (!project.needsReview) return null;
  return project.completeReviewCount === 0 ? "No reviews yet" : project.completeReviewCount === target - 1 ? "Needs a second review" : `${project.completeReviewCount} of ${target} reviews`;
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

/** "Are you Priya Nair?" before the first score. Yes records Opened; "I'm someone else" stops here. */
function ConfirmJudge({ data, onConfirm, busy, error }: { data: Workspace; onConfirm: () => void; busy: boolean; error: string }) {
  const [elsewhere, setElsewhere] = useState(false);
  return (
    <main className={`dq-app ${styles.waitingPage}`}>
      <section className={styles.waitingPanel} aria-labelledby="confirm-title">
        <div className={styles.privateLabel}><LockKeyholeIcon /> Private judge link · {data.eventName}</div>
        {elsewhere ? <>
          <h1 id="confirm-title">This link is for {data.judgeName}</h1>
          <p>Each judge has their own link, so scores land under the right name. Ask the event team for yours, and close this page.</p>
          <div className={styles.confirmActions}><Button variant="outline" onClick={() => setElsewhere(false)}>Back</Button></div>
        </> : <>
          <h1 id="confirm-title">Are you {data.judgeName}?</h1>
          <p>Your scores are saved under this name. If this link reached you by mistake, say so and nothing is recorded.</p>
          {error && <p role="alert" className={styles.saveError}>{error}</p>}
          <div className={styles.confirmActions}>
            <Button onClick={onConfirm} disabled={busy} autoFocus>{busy ? "One moment…" : `Yes, I'm ${data.judgeName}`}</Button>
            <Button variant="outline" onClick={() => setElsewhere(true)} disabled={busy}>I&apos;m someone else</Button>
          </div>
        </>}
      </section>
    </main>
  );
}

export default function JudgeClientPage() {
  const params = useParams<{ slug: string; token: string }>();
  const data = useQuery(api.judging.getJudgeWorkspace, { slug: params.slug, capabilityToken: params.token });
  const confirmJudge = useMutation(api.judging.confirmJudge);
  const saveReview = useMutation(api.judging.saveReview);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [notYou, setNotYou] = useState(false);

  async function confirm() {
    setConfirming(true); setConfirmError("");
    try { await confirmJudge({ slug: params.slug, capabilityToken: params.token }); setNotYou(false); }
    catch { setConfirmError("Could not confirm. Check your connection and try again."); }
    finally { setConfirming(false); }
  }

  if (!data) {
    return <main className={`dq-app ${styles.loadingPage}`}><section className={styles.loadingPanel}><Skeleton w={170} h={12} /><Skeleton w="48%" h={38} style={{ marginTop: 18 }} /><Skeleton h={520} style={{ marginTop: 22 }} /></section></main>;
  }
  if (data.openedAt === null || notYou) return <ConfirmJudge data={data} onConfirm={() => void confirm()} busy={confirming} error={confirmError} />;
  if (data.judgingStatus !== "open" && data.judgingStatus !== "closed") {
    return (
      <main className={`dq-app ${styles.waitingPage}`}>
        <section className={styles.waitingPanel}>
          <div className={styles.privateLabel}><LockKeyholeIcon /> Private judge link</div>
          <h1>{data.eventName}</h1>
          <p>Hi {data.judgeName}. Your projects appear here when the event team opens judging. Keep this page open.</p>
        </section>
      </main>
    );
  }
  return <JudgeWorkspace data={data} slug={params.slug} token={params.token} saveReview={saveReview} onNotYou={() => setNotYou(true)} />;
}

function JudgeWorkspace({ data, slug, token, saveReview, onNotYou }: {
  data: Workspace; slug: string; token: string;
  saveReview: ReturnType<typeof useMutation<typeof api.judging.saveReview>>;
  onNotYou: () => void;
}) {
  const [scores, setScores] = useState<Record<string, ScoreState>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>(() => (data.counts.yours > 0 ? "yours" : data.counts.helpOut > 0 ? "helpOut" : "all"));
  const [showOpen, setShowOpen] = useState(false);
  const [tracks, setTracks] = useState<string[]>([]);
  const [activeCriterion, setActiveCriterion] = useState<Criterion>("innovation");
  const pendingOne = useRef<{ at: number; criterion: Criterion } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const remainingMs = useJudgingClock(data.timer);
  const timeUp = remainingMs <= 0;
  const isClosed = data.judgingStatus === "closed";

  // Saved scores from the server fill in anything not edited on this page.
  useEffect(() => {
    setScores((current) => {
      const next = { ...current };
      for (const project of data.projects) {
        if (next[String(project.id)] || !project.review) continue;
        next[String(project.id)] = Object.fromEntries(JUDGING_CRITERIA.filter((criterion) => project.review?.[criterion] !== null && project.review?.[criterion] !== undefined).map((criterion) => [criterion, project.review?.[criterion]])) as ScoreState;
      }
      return next;
    });
  }, [data.projects]);

  const searchKey = search.trim().toLocaleLowerCase("en");
  const trackMatch = useCallback((project: Project) => tracks.length === 0 || tracks.some((track) => (track === MAIN_EVENT ? project.trackIds.length === 0 : project.trackIds.map(String).includes(track))), [tracks]);
  const filtered = useMemo(() => data.projects.filter((project) => trackMatch(project) && matchesSearch(project, searchKey)), [data.projects, trackMatch, searchKey]);
  const order: Record<Project["group"], number> = { yours: 0, helpOut: 1, scored: 2, other: 3 };
  const visible = useMemo(() => (show === "all" ? [...filtered].sort((a, b) => order[a.group] - order[b.group]) : filtered.filter((project) => project.group === show)), [filtered, show]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenInAll = filtered.length - visible.length;

  useEffect(() => {
    setSelectedId((current) => {
      if (current && data.projects.some((project) => String(project.id) === current)) return current;
      const first = visible[0] ?? data.projects[0];
      return first ? String(first.id) : null;
    });
  }, [data.projects, visible]);

  useEffect(() => { if (selectedId) document.getElementById(`judge-row-${selectedId}`)?.scrollIntoView({ block: "nearest" }); }, [selectedId]);

  const selected = data.projects.find((project) => String(project.id) === selectedId) ?? null;
  const selectedIndex = visible.findIndex((project) => String(project.id) === selectedId);
  const currentScores = selected ? scores[String(selected.id)] ?? {} : {};
  const canScore = Boolean(data.canScore && selected);
  const yoursScored = data.projects.filter((project) => project.assignedToMe && (scores[String(project.id)] ? scoreIsComplete(scores[String(project.id)]) : project.review?.completed)).length;

  // The first unscored criterion is where number keys go.
  useEffect(() => { setActiveCriterion(JUDGING_CRITERIA.find((criterion) => currentScores[criterion] === undefined) ?? "innovation"); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function step(offset: number) {
    const next = selectedIndex < 0 ? (offset > 0 ? visible[0] : undefined) : visible[selectedIndex + offset];
    if (next) setSelectedId(String(next.id));
  }

  async function updateScore(submissionId: string, criterion: Criterion, value: number) {
    const nextScores = { ...(scores[submissionId] ?? {}), [criterion]: value };
    setScores((current) => ({ ...current, [submissionId]: nextScores }));
    setSaveState((current) => ({ ...current, [submissionId]: "saving" }));
    try {
      await saveReview({ slug, capabilityToken: token, submissionId: submissionId as Id<"submissions">, innovation: nextScores.innovation, execution: nextScores.execution, demoClarity: nextScores.demoClarity });
      setSaveState((current) => ({ ...current, [submissionId]: "saved" }));
    } catch {
      setSaveState((current) => ({ ...current, [submissionId]: "error" }));
    }
  }

  function pick(criterion: Criterion, value: number) {
    if (!selected || !canScore) return;
    void updateScore(String(selected.id), criterion, value);
    const index = JUDGING_CRITERIA.indexOf(criterion);
    setActiveCriterion(JUDGING_CRITERIA[Math.min(index + 1, JUDGING_CRITERIA.length - 1)]);
  }

  // Keys: J/K walk the list, / searches, 0 to 9 score (1 then 0 is 10), and 1 to 4 pick Show while it is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const key = event.key;
      if (showOpen && /^[1-4]$/.test(key)) { event.preventDefault(); setShow(SHOW_OPTIONS[Number(key) - 1].value); setShowOpen(false); return; }
      if (key === "/") { event.preventDefault(); searchRef.current?.focus(); return; }
      if (key.toLowerCase() === "j") { step(1); return; }
      if (key.toLowerCase() === "k") { step(-1); return; }
      if (!/^[0-9]$/.test(key) || !selected || !canScore) return;
      event.preventDefault();
      const now = Date.now();
      const one = pendingOne.current;
      if (key === "0" && one && now - one.at < 700) {
        pendingOne.current = null;
        void updateScore(String(selected.id), one.criterion, 10);
        return;
      }
      const criterion = activeCriterion;
      pendingOne.current = key === "1" ? { at: now, criterion } : null;
      pick(criterion, Number(key));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const currentSaveState = selected ? saveState[String(selected.id)] : undefined;
  const currentComplete = scoreIsComplete(currentScores);
  const saveLabel = !selected ? "" : currentSaveState === "saving" ? "Saving…" : currentSaveState === "error" ? "Could not save" : currentSaveState === "saved" || currentComplete ? "Saved" : Object.keys(currentScores).length ? "Saved" : "Not started";
  const saveClass = currentSaveState === "error" ? styles.saveError : saveLabel === "Saved" ? styles.saveState : styles.savePending;
  const youtubeUrl = youtubeEmbedUrl(selected?.videoUrl ?? null);
  const embedUrl = youtubeUrl ?? genericVideoEmbedUrl(selected?.videoUrl ?? null);
  const showOption = SHOW_OPTIONS.find((option) => option.value === show)!;
  const trackLabel = tracks.length === 0 ? "All" : tracks.length === 1 ? (tracks[0] === MAIN_EVENT ? "Main event only" : data.tracks.find((track) => String(track.id) === tracks[0])?.name ?? "1 track") : `${tracks.length} selected`;
  const note = selected ? reviewNote(selected, data.reviewTarget) : null;
  const clockLabel = isClosed ? "Judging closed" : data.judgingPaused ? "Judging paused" : data.timer.paused ? "Clock paused at" : timeUp ? "Time's up" : "Judging closes in";

  return (
    <TooltipProvider delay={1000}>
    <main className={`dq-app ${styles.workspace}`}>
      <header className={styles.topbar}>
        <div className={styles.eventIdentity}>
          <span className={styles.eventMark} aria-hidden>{data.eventName.slice(0, 1).toUpperCase()}</span>
          <span className={styles.eventName}>{data.eventName}</span>
          {data.practice && <span className="dq-practice-badge">Practice</span>}
          <span className={styles.divider} />
          <span className={styles.timeBlock}>
            <span>{clockLabel}</span>
            {!isClosed && <strong className={timeUp && !data.judgingPaused ? styles.overtime : undefined}>{formatTimer(remainingMs)}</strong>}
          </span>
        </div>
        <div className={styles.topActions}>
          <span className={styles.progress}>Yours: {yoursScored} of {data.yoursTotal} scored</span>
          <span className={styles.scoringAs}>Scoring as <strong>{data.judgeName}</strong><button type="button" onClick={onNotYou}>Not you?</button></span>
        </div>
      </header>

      <div className={styles.columns}>
        <aside className={styles.assignmentRail}>
          <div className={styles.railHeader}>
            <label className={styles.searchField}>
              <span className={styles.visuallyHidden}>Search projects</span>
              <SearchIcon aria-hidden="true" />
              <input ref={searchRef} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setSearch(""); event.currentTarget.blur(); } }} placeholder={`Search ${data.counts.all} projects, teams, tech`} type="search" value={search} />
              <kbd className={styles.searchKey} aria-hidden>/</kbd>
            </label>
            <div className={styles.filters}>
              <Popover open={showOpen} onOpenChange={setShowOpen}>
                <PopoverTrigger className={styles.filterButton} aria-label={`Show: ${showOption.label}`}><span>Show</span><strong>{showOption.label}</strong><span className={styles.filterCount}>{data.counts[show]}</span><ChevronDownIcon aria-hidden /></PopoverTrigger>
                <PopoverContent align="start" sideOffset={4} className={styles.menu}>
                  <div role="listbox" aria-label="Show">
                    {SHOW_OPTIONS.map((option) => <button key={option.value} type="button" role="option" aria-selected={show === option.value} className={styles.menuItem} onClick={() => { setShow(option.value); setShowOpen(false); }}>
                      <span className={styles.menuText}><strong>{option.label}</strong><small>{option.hint}</small></span>
                      <span className={styles.filterCount}>{data.counts[option.value]}</span>
                      <kbd className={styles.menuKey}>{option.key}</kbd>
                    </button>)}
                  </div>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger className={styles.filterButton} aria-label={`Track: ${trackLabel}`}><span>Track</span><strong>{trackLabel}</strong><ChevronDownIcon aria-hidden /></PopoverTrigger>
                <PopoverContent align="start" sideOffset={4} className={styles.menu}>
                  <div role="group" aria-label="Tracks">
                    <button type="button" className={styles.menuItem} aria-pressed={tracks.length === 0} onClick={() => setTracks([])}><span className={styles.menuText}><strong>All tracks</strong></span><span className={styles.filterCount}>{data.counts.all}</span></button>
                    {[...data.tracks.map((track) => ({ id: String(track.id), name: track.name, count: track.count })), { id: MAIN_EVENT, name: "Main event only", count: data.mainEventCount }].map((track) => {
                      const on = tracks.includes(track.id);
                      return <label key={track.id} className={styles.menuItem}>
                        <Checkbox checked={on} onCheckedChange={(checked) => setTracks((current) => (checked ? [...current, track.id] : current.filter((id) => id !== track.id)))} />
                        <span className={styles.menuText}><strong>{track.name}</strong></span>
                        <span className={styles.filterCount}>{track.count}</span>
                      </label>;
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <nav className={styles.assignmentList} aria-label="Projects">
            <h2 className={styles.mineHeading}><span>{GROUP_HEADINGS[show]}</span><span>{visible.length}</span></h2>
            {visible.map((project) => <ProjectRow key={String(project.id)} project={project} active={String(project.id) === selectedId} scores={scores[String(project.id)]} reviewTarget={data.reviewTarget} onSelect={() => setSelectedId(String(project.id))} />)}
            {visible.length === 0 && <p className={styles.railEmpty}>{search || tracks.length ? "Nothing here matches. Clear the search or the track filter." : show === "yours" ? "You've scored all of yours. Help out with projects still waiting for a second review." : show === "helpOut" ? "Nothing needs help right now. Every other project has its reviews." : show === "scored" ? "You haven't scored anything yet." : "No projects are in judging yet."}</p>}
            {show !== "all" && hiddenInAll > 0 && <button type="button" className={styles.moreLink} onClick={() => setShow("all")}>Show {hiddenInAll} more in All</button>}
          </nav>
        </aside>

        <article className={styles.projectPane}>
          {selected ? (
            <>
              <div className={styles.projectIntro}>
                <div className={styles.projectTitle}>
                  <h1>{selected.demoTitle}</h1>
                  <span className={styles.projectTeam}>{teamLine(selected)}</span>
                  {selected.tracks.length ? selected.tracks.map((track) => <span className={styles.trackPill} key={track}>{track}</span>) : <span className="dq-track-none">Main event</span>}
                  {note && <span className={styles.assignmentPill}>{note}</span>}
                </div>
                <AiSummarySlot summary={selected.aiSummary} status={selected.aiSummaryStatus} />
              </div>
              {embedUrl ? (
                <div className={styles.videoFrame}>
                  <iframe allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox={youtubeUrl ? undefined : "allow-forms allow-presentation allow-same-origin allow-scripts"} src={embedUrl} title={`${selected.demoTitle} demo video`} />
                </div>
              ) : selected.videoUrl ? (
                <a className={styles.videoFallback} href={selected.videoUrl} target="_blank" rel="noreferrer">Open the demo video <ExternalLinkIcon /></a>
              ) : (
                <div className={styles.videoFallback}>No demo video was provided.</div>
              )}
              <div className={styles.projectLinks}>
                <span>
                  {selected.githubUrl ? <a href={selected.githubUrl} target="_blank" rel="noreferrer">GitHub repository</a> : null}
                  {selected.videoUrl ? <a href={selected.videoUrl} target="_blank" rel="noreferrer">Demo video</a> : null}
                </span>
                <span><a href="#project-description">Team&apos;s description</a><a href="#project-readme">README</a></span>
              </div>
              <section id="project-description" className={styles.descriptionSection}>
                <div className={styles.sectionLabel}>Team&apos;s description</div>
                <p className={styles.description}>{selected.description}</p>
              </section>
              <Readme repositoryUrl={selected.githubUrl} />
            </>
          ) : <p className={styles.emptyCopy}>No projects are in judging yet.</p>}
        </article>

        <aside className={styles.scorePanel}>
          <div className={styles.scoreHeading}>
            <div><h2>Score this project</h2>{selected && !selected.assignedToMe && <p>Not one of yours. Your score counts as your own review.</p>}</div>
            {selected && <span className={saveClass} role="status">{saveLabel}</span>}
          </div>
          {isClosed ? <div className={styles.closedNotice}>Judging is closed, so scores can no longer change.</div> : null}
          {!isClosed && data.judgingPaused ? <div className={styles.closedNotice}>Judging is paused while submissions are open again. Your scores are kept; carry on when it resumes.</div> : null}
          <TooltipProvider delay={250}>
          <div className={styles.criteria}>
            {JUDGING_CRITERIA.map((criterion) => (
              <fieldset className={styles.criterion} key={criterion} data-active={canScore && activeCriterion === criterion ? "" : undefined}>
                <legend className={styles.criterionTitle}><span>{JUDGING_CRITERION_LABELS[criterion]}</span>{currentScores[criterion] !== undefined && <span className={styles.criterionPicked}>{currentScores[criterion]} · {scoreBand(currentScores[criterion]!).name}</span>}</legend>
                <span className={styles.criterionHelp}>{CRITERION_HELP[criterion]}</span>
                <div className={styles.scoreScale} role="radiogroup" aria-label={`${JUDGING_CRITERION_LABELS[criterion]} score`}>
                  {Array.from({ length: 11 }, (_, value) => {
                    const picked = currentScores[criterion] === value;
                    const band = scoreBand(value);
                    return (
                      <Tooltip key={value}>
                        <TooltipTrigger render={<button aria-checked={picked} aria-label={`${value}, ${band.name}`} className={picked ? styles.scoreSelected : styles.scoreOption} disabled={!canScore} onClick={() => pick(criterion, value)} onFocus={() => setActiveCriterion(criterion)} role="radio" type="button" />}>{value}</TooltipTrigger>
                        <TooltipContent className={styles.scoreTip}><strong>{value} · {band.name}</strong><span>{band.text}</span><span className={styles.scoreTipKey}>Press <kbd>{value === 10 ? "1 0" : value}</kbd></span></TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          </TooltipProvider>
          <details className={styles.guide}>
            <summary>What the numbers mean</summary>
            <dl>{SCORE_BANDS.map((band) => <div key={band.name}><dt>{band.from} to {band.to}</dt><dd><strong>{band.name}.</strong> {band.text}</dd></div>)}</dl>
            <p>Most projects land between 4 and 7. Keep 9 and 10 for the best of the night.</p>
          </details>
          <div className={styles.scoreNav}>
            <ShortcutTooltip label="Previous project" keys={["K"]}><Button variant="outline" disabled={selectedIndex <= 0} onClick={() => step(-1)}><ChevronLeftIcon /> Previous</Button></ShortcutTooltip>
            <ShortcutTooltip label="Next project" keys={["J"]}><Button className={styles.nextProject} disabled={selectedIndex >= visible.length - 1} onClick={() => step(1)}>Next project <ChevronRightIcon /></Button></ShortcutTooltip>
          </div>
        </aside>
      </div>
    </main>
    </TooltipProvider>
  );
}

function ProjectRow({ project, active, scores, reviewTarget, onSelect }: { project: Project; active: boolean; scores: ScoreState | undefined; reviewTarget: number; onSelect: () => void }) {
  const id = String(project.id);
  const complete = scores ? scoreIsComplete(scores) : Boolean(project.review?.completed);
  const note = project.group === "helpOut" ? `${project.completeReviewCount} of ${reviewTarget}` : null;
  return (
    <button aria-current={active ? "true" : undefined} className={active ? styles.assignmentActive : styles.assignmentButton} id={`judge-row-${id}`} onClick={onSelect} type="button">
      {complete ? <CheckCircle2Icon aria-label="Scored" className={styles.completeIcon} /> : <CircleIcon aria-label="Not scored" className={styles.incompleteIcon} />}
      <span className={styles.assignmentText}><strong>{project.demoTitle}</strong><small>{project.teamName ?? project.name} · {project.tracks.join(", ") || "Main event"}</small></span>
      {note ? <span className={styles.rowNote}>{note}</span> : <span />}
    </button>
  );
}
