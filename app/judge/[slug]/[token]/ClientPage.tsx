"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  ExternalLinkIcon,
  GitForkIcon,
  LockKeyholeIcon,
  SearchIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { api } from "../../../../convex/_generated/api";
import { Skeleton } from "@/app/Skeleton";
import { Button } from "@/components/ui/button";
import {
  JUDGING_CRITERIA,
  JUDGING_CRITERION_LABELS,
} from "@/lib/judging-rubric";
import { Id } from "../../../../convex/_generated/dataModel";
import styles from "./judge.module.css";

type Criterion = (typeof JUDGING_CRITERIA)[number];
type ScoreState = Partial<Record<Criterion, number>>;

const CRITERION_HELP: Record<Criterion, string> = {
  innovation: "Originality of the idea and how clearly it differs from existing solutions.",
  execution: "Quality, robustness, and completeness of the implementation.",
  demoClarity: "How effectively the demo communicates the product and its value.",
};

function scoreIsComplete(scores: ScoreState) {
  return JUDGING_CRITERIA.every((criterion) => scores[criterion] !== undefined);
}

function formatTimer(ms: number) {
  const seconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absolute = Math.abs(seconds);
  return `${seconds < 0 ? "-" : ""}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

function useSignedTimer(timer: { remainingMs: number; serverNow: number; running: boolean } | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer?.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer?.running, timer?.serverNow, timer?.remainingMs]);
  if (!timer) return 0;
  return timer.running ? timer.remainingMs - (now - timer.serverNow) : timer.remainingMs;
}

function youtubeEmbedUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
      else id = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? "";
    }
    return /^[A-Za-z0-9_-]{6,}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
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
  const [state, setState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    markdown: string;
  }>({ status: "idle", markdown: "" });

  useEffect(() => {
    if (!repositoryUrl) {
      setState({ status: "idle", markdown: "" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", markdown: "" });
    void fetch(`/api/github-readme?url=${encodeURIComponent(repositoryUrl)}`, {
      signal: controller.signal,
    })
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
    <section className={styles.readmeSection}>
      <div className={styles.sectionLabel}><BookOpenIcon /> README</div>
      {state.status === "loading" ? (
        <div className={styles.readmeLoading}><Skeleton w="58%" h={24} /><Skeleton h={14} /><Skeleton w="85%" h={14} /><Skeleton h={90} /></div>
      ) : state.status === "ready" ? (
        <div className={styles.markdown}>
          <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>{state.markdown}</ReactMarkdown>
        </div>
      ) : (
        <p className={styles.emptyCopy}>
          {repositoryUrl ? "The README could not be displayed here. Open the repository to review it on GitHub." : "No GitHub repository was provided."}
        </p>
      )}
    </section>
  );
}

type JudgeEntry = {
  id: Id<"submissions">;
  demoTitle: string;
  description: string;
  name: string;
  teamName: string | null;
  memberCount: number;
  tracks: string[];
  githubUrl: string | null;
  videoUrl: string | null;
  review: { completed: boolean } | null;
  assigned: boolean;
  number: number;
};

function matchesSearch(entry: JudgeEntry, search: string) {
  if (!search) return true;
  return [entry.demoTitle, entry.name, entry.teamName ?? "", ...entry.tracks].some((value) =>
    value.toLocaleLowerCase("en").includes(search),
  );
}

function teamLine(entry: JudgeEntry) {
  if (!entry.teamName) return entry.name;
  return `${entry.teamName} · ${entry.memberCount} ${entry.memberCount === 1 ? "member" : "members"}`;
}

export default function JudgeClientPage() {
  const params = useParams<{ slug: string; token: string }>();
  const data = useQuery(api.judging.getMyAssignments, {
    slug: params.slug,
    capabilityToken: params.token,
  });
  const others = useQuery(api.judging.getOtherSubmissions, {
    slug: params.slug,
    capabilityToken: params.token,
  });
  const saveReview = useMutation(api.judging.saveReview);
  const [scores, setScores] = useState<Record<string, ScoreState>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState<string | null>(null);
  const remainingMs = useSignedTimer(data?.timer);

  // Assigned submissions first, then everyone else, numbered in that order.
  const entries = useMemo<JudgeEntry[]>(() => {
    if (!data) return [];
    const mine = data.assignments.map((assignment, index) => ({ ...assignment, assigned: true, number: index + 1 }));
    const rest = (others ?? []).map((other, index) => ({ ...other, review: null, assigned: false, number: mine.length + index + 1 }));
    return [...mine, ...rest];
  }, [data, others]);
  const trackNames = useMemo(() => {
    const names = [...(data?.trackNames ?? [])];
    for (const entry of entries) for (const track of entry.tracks) if (!names.includes(track)) names.push(track);
    return names;
  }, [data, entries]);
  const searchKey = search.trim().toLocaleLowerCase("en");
  const visible = useMemo(
    () => entries.filter((entry) => (!trackFilter || entry.tracks.includes(trackFilter)) && matchesSearch(entry, searchKey)),
    [entries, trackFilter, searchKey],
  );
  const visibleMine = visible.filter((entry) => entry.assigned);
  const visibleOthers = visible.filter((entry) => !entry.assigned);

  useEffect(() => {
    if (!data) return;
    setScores((current) => {
      const next = { ...current };
      for (const assignment of data.assignments) {
        if (next[String(assignment.id)]) continue;
        next[String(assignment.id)] = Object.fromEntries(
          JUDGING_CRITERIA.filter((criterion) => assignment.review?.[criterion] !== undefined)
            .map((criterion) => [criterion, assignment.review?.[criterion]]),
        ) as ScoreState;
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setSelectedId((current) => {
      if (current && entries.some((entry) => String(entry.id) === current)) return current;
      const first = data.assignments.find((assignment) => !assignment.review?.completed) ?? entries[0];
      return first ? String(first.id) : null;
    });
  }, [data, entries]);

  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`judge-row-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const completedCount = useMemo(
    () => data?.assignments.filter((assignment) => {
      const localScores = scores[String(assignment.id)];
      return localScores ? scoreIsComplete(localScores) : Boolean(assignment.review?.completed);
    }).length ?? 0,
    [data, scores],
  );
  const selected = entries.find((entry) => String(entry.id) === selectedId);
  const selectedIndex = visible.findIndex((entry) => String(entry.id) === selectedId);
  const isOpen = data?.judgingStatus === "open";
  const isClosed = data?.judgingStatus === "closed";

  // J and K walk the visible list: your assignments first, then the rest.
  function stepTarget(offset: number) {
    if (selectedIndex < 0) return offset > 0 ? visible[0] : undefined;
    return visible[selectedIndex + offset];
  }

  function selectOffset(offset: number) {
    const next = stepTarget(offset);
    if (next) setSelectedId(String(next.id));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const offset = event.key.toLowerCase() === "j" ? -1 : event.key.toLowerCase() === "k" ? 1 : 0;
      if (!offset) return;
      const next = selectedIndex < 0 ? (offset > 0 ? visible[0] : undefined) : visible[selectedIndex + offset];
      if (next) setSelectedId(String(next.id));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, selectedIndex]);

  async function updateScore(submissionId: string, criterion: Criterion, value: string) {
    const numeric = value === "" ? undefined : Number(value);
    const nextScores = { ...(scores[submissionId] ?? {}), [criterion]: numeric };
    setScores((current) => ({ ...current, [submissionId]: nextScores }));
    setSaveState((current) => ({ ...current, [submissionId]: "saving" }));
    try {
      await saveReview({
        slug: params.slug,
        capabilityToken: params.token,
        submissionId: submissionId as Id<"submissions">,
        innovation: nextScores.innovation,
        execution: nextScores.execution,
        demoClarity: nextScores.demoClarity,
      });
      setSaveState((current) => ({ ...current, [submissionId]: "saved" }));
    } catch {
      setSaveState((current) => ({ ...current, [submissionId]: "error" }));
    }
  }

  if (!data) {
    return <main className={styles.loadingPage}><section className={styles.loadingPanel}><Skeleton w={170} h={12} /><Skeleton w="48%" h={38} style={{ marginTop: 18 }} /><Skeleton h={520} style={{ marginTop: 22 }} /></section></main>;
  }
  if (!isOpen && !isClosed) {
    return (
      <main className={styles.waitingPage}>
        <section className={styles.waitingPanel}>
          <div className={styles.privateLabel}><LockKeyholeIcon /> Private judge link</div>
          <h1>{data.eventName}</h1>
          <p>Hi {data.judgeName}. Your assignments will appear here when the event team opens judging.</p>
        </section>
      </main>
    );
  }

  const canScore = Boolean(isOpen && selected?.assigned);
  const currentScores = selected?.assigned ? scores[String(selected.id)] ?? {} : {};
  const currentSaveState = selected?.assigned ? saveState[String(selected.id)] : undefined;
  const currentComplete = selected?.assigned ? scoreIsComplete(currentScores) : false;
  const youtubeUrl = youtubeEmbedUrl(selected?.videoUrl ?? null);
  const embedUrl = youtubeUrl ?? genericVideoEmbedUrl(selected?.videoUrl ?? null);
  const saveStateClass = currentSaveState === "error"
    ? styles.saveError
    : currentSaveState === "saved" || currentComplete
      ? styles.saveState
      : styles.savePending;
  const saveLabel = !selected || !selected.assigned
    ? "Read only"
    : currentSaveState === "saving" ? "Saving…" : currentSaveState === "error" ? "Could not save" : currentSaveState === "saved" || currentComplete ? "Saved" : "Not started";
  const hasPrevious = Boolean(stepTarget(-1));
  const hasNext = Boolean(stepTarget(1));

  function rowFor(entry: JudgeEntry) {
    const id = String(entry.id);
    const active = id === selectedId;
    if (!entry.assigned) {
      return (
        <button aria-current={active ? "true" : undefined} className={active ? styles.otherActive : styles.otherRow} id={`judge-row-${id}`} key={id} onClick={() => setSelectedId(id)} type="button">
          <span className={styles.rowNumber}>{entry.number}</span>
          <span className={styles.otherTitle}>{entry.demoTitle}</span>
          <span className={styles.otherTrack}>{entry.tracks[0] ?? ""}</span>
        </button>
      );
    }
    const localScores = scores[id];
    const complete = localScores ? scoreIsComplete(localScores) : Boolean(entry.review?.completed);
    return (
      <button aria-current={active ? "true" : undefined} className={active ? styles.assignmentActive : styles.assignmentButton} id={`judge-row-${id}`} key={id} onClick={() => setSelectedId(id)} type="button">
        <span className={styles.rowNumber}>{entry.number}</span>
        <span className={styles.assignmentText}><strong>{entry.demoTitle}</strong><small>{entry.tracks.join(" · ") || entry.name}</small></span>
        {complete ? <CheckCircle2Icon aria-label="Scored" className={styles.completeIcon} /> : <CircleIcon aria-label="Not scored" className={styles.incompleteIcon} />}
      </button>
    );
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <div className={styles.eventIdentity}>
          <span className={styles.privateLabel}><LockKeyholeIcon /> Private judge link</span>
          <span className={styles.divider} />
          <span className={styles.eventName}>{data.eventName}</span>
        </div>
        <div className={styles.timeBlock}>
          <span>{isClosed ? "Judging closed" : "Time remaining"}</span>
          <strong className={remainingMs < 0 ? styles.overtime : undefined}>{formatTimer(remainingMs)}</strong>
        </div>
        <div className={styles.topActions}>
          <Button variant="outline" disabled={!hasPrevious} onClick={() => selectOffset(-1)}><ChevronLeftIcon /> Previous</Button>
          <Button disabled={!hasNext} onClick={() => selectOffset(1)}>Next <ChevronRightIcon /></Button>
        </div>
      </header>

      <div className={styles.columns}>
        <aside className={styles.assignmentRail}>
          <div className={styles.railHeader}>
            <label className={styles.searchField}>
              <span className={styles.visuallyHidden}>Search submissions</span>
              <SearchIcon aria-hidden="true" />
              <input onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${entries.length} submissions`} type="search" value={search} />
            </label>
            {trackNames.length ? (
              <div aria-label="Filter by track" className={styles.trackFilters} role="group">
                {[null, ...trackNames].map((track) => (
                  <button aria-pressed={trackFilter === track} className={trackFilter === track ? styles.trackChipOn : styles.trackChip} key={track ?? "all"} onClick={() => setTrackFilter(track)} type="button">
                    {track ?? "All tracks"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <nav className={styles.assignmentList} aria-label="Submissions">
            <h2 className={styles.mineHeading}><span>Assigned to you</span><span>{completedCount} of {data.assignments.length} scored</span></h2>
            {visibleMine.map(rowFor)}
            {!visibleMine.length ? <p className={styles.railEmpty}>{data.assignments.length ? "None of yours match." : "Nothing is assigned to you."}</p> : null}
            <h2 className={styles.othersHeading}><span>All other submissions</span><span>{others === undefined ? "" : visibleOthers.length}</span></h2>
            {others === undefined ? (
              <div className={styles.railLoading}><Skeleton h={14} /><Skeleton w="80%" h={14} /><Skeleton w="65%" h={14} /></div>
            ) : visibleOthers.length ? visibleOthers.map(rowFor) : (
              <p className={styles.railEmpty}>{others.length ? "No other submissions match." : "No other submissions."}</p>
            )}
          </nav>
          <p className={styles.shortcutHint}><kbd>J</kbd> and <kbd>K</kbd> move through yours first, then the rest</p>
        </aside>

        <article className={styles.projectPane}>
          {selected ? (
            <>
              <div className={styles.projectIntro}>
                <h1>{selected.demoTitle}</h1>
                <div className={styles.projectMeta}>
                  <strong>{teamLine(selected)}</strong>
                  {selected.tracks.map((track) => <span className={styles.trackPill} key={track}>{track}</span>)}
                  <span className={styles.assignmentPill}>{selected.assigned ? "Assigned to you" : "Not assigned to you"}</span>
                </div>
                <p className={styles.description}>{selected.description}</p>
                <div className={styles.projectLinks}>
                  {selected.githubUrl ? <a href={selected.githubUrl} target="_blank" rel="noreferrer"><GitForkIcon /> GitHub repository <ExternalLinkIcon /></a> : null}
                  {selected.videoUrl ? <a href={selected.videoUrl} target="_blank" rel="noreferrer">Demo video <ExternalLinkIcon /></a> : null}
                </div>
              </div>
              {embedUrl ? (
                <div className={styles.videoFrame}>
                  <iframe
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    sandbox={youtubeUrl ? undefined : "allow-forms allow-presentation allow-same-origin allow-scripts"}
                    src={embedUrl}
                    title={`${selected.demoTitle} demo video`}
                  />
                </div>
              ) : selected.videoUrl ? (
                <a className={styles.videoFallback} href={selected.videoUrl} target="_blank" rel="noreferrer">Open the demo video <ExternalLinkIcon /></a>
              ) : (
                <div className={styles.videoFallback}>No demo video was provided.</div>
              )}
              <Readme repositoryUrl={selected.githubUrl} />
            </>
          ) : <p className={styles.emptyCopy}>No submissions are in judging yet.</p>}
        </article>

        <aside className={styles.scorePanel}>
          <div className={styles.scoreHeading}>
            <div><h2>Score this project</h2><p>Score each criterion from 0 to 10.</p></div>
            <span className={selected?.assigned ? saveStateClass : styles.savePending} role="status">{saveLabel}</span>
          </div>
          {isClosed ? <div className={styles.closedNotice}>Scores are read-only because judging is closed.</div> : null}
          {selected && !selected.assigned ? (
            <div className={styles.closedNotice}>This project is assigned to other judges. You can read it, but only they score it.</div>
          ) : null}
          <div className={styles.criteria}>
            {JUDGING_CRITERIA.map((criterion) => (
              <fieldset className={styles.criterion} key={criterion}>
                <legend className={styles.criterionTitle}>{JUDGING_CRITERION_LABELS[criterion]}</legend>
                <span className={styles.criterionHelp}>{CRITERION_HELP[criterion]}</span>
                <div className={styles.scoreScale} role="radiogroup" aria-label={`${JUDGING_CRITERION_LABELS[criterion]} score`}>
                  {Array.from({ length: 11 }, (_, value) => {
                    const selectedScore = currentScores[criterion] === value;
                    return (
                      <button
                        aria-checked={selectedScore}
                        className={selectedScore ? styles.scoreSelected : styles.scoreOption}
                        disabled={!canScore}
                        key={value}
                        onClick={() => selected && canScore && void updateScore(String(selected.id), criterion, String(value))}
                        role="radio"
                        type="button"
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <Button className={styles.nextProject} disabled={!hasNext} onClick={() => selectOffset(1)}>Next project <ChevronRightIcon /></Button>
        </aside>
      </div>
    </main>
  );
}
