"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  LockKeyholeIcon,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Skeleton } from "@/app/Skeleton";
import { Button } from "@/components/ui/button";
import { ProjectReviewContent } from "@/components/ProjectReviewContent";
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

export default function JudgeClientPage() {
  const params = useParams<{ slug: string; token: string }>();
  const data = useQuery(api.judging.getMyAssignments, {
    slug: params.slug,
    capabilityToken: params.token,
  });
  const saveReview = useMutation(api.judging.saveReview);
  const [scores, setScores] = useState<Record<string, ScoreState>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const remainingMs = useSignedTimer(data?.timer);

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
    setSelectedId((current) => {
      if (current && data.assignments.some((assignment) => String(assignment.id) === current)) return current;
      return String(data.assignments.find((assignment) => !assignment.review?.completed)?.id ?? data.assignments[0]?.id ?? "") || null;
    });
  }, [data]);

  const completedCount = useMemo(
    () => data?.assignments.filter((assignment) => {
      const localScores = scores[String(assignment.id)];
      return localScores ? scoreIsComplete(localScores) : Boolean(assignment.review?.completed);
    }).length ?? 0,
    [data, scores],
  );
  const selectedIndex = data?.assignments.findIndex((assignment) => String(assignment.id) === selectedId) ?? -1;
  const selected = selectedIndex >= 0 ? data?.assignments[selectedIndex] : undefined;
  const isOpen = data?.judgingStatus === "open";
  const isClosed = data?.judgingStatus === "closed";

  function selectOffset(offset: number) {
    if (!data || selectedIndex < 0) return;
    const next = data.assignments[selectedIndex + offset];
    if (next) setSelectedId(String(next.id));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const offset = event.key.toLowerCase() === "j" ? -1 : event.key.toLowerCase() === "k" ? 1 : 0;
      const next = data?.assignments[selectedIndex + offset];
      if (offset && next) setSelectedId(String(next.id));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data, selectedIndex]);

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

  const currentScores = selected ? scores[String(selected.id)] ?? {} : {};
  const currentSaveState = selected ? saveState[String(selected.id)] : undefined;
  const currentComplete = scoreIsComplete(currentScores);
  const saveStateClass = currentSaveState === "error"
    ? styles.saveError
    : currentSaveState === "saved" || currentComplete
      ? styles.saveState
      : styles.savePending;

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
          <Button variant="outline" disabled={selectedIndex <= 0} onClick={() => selectOffset(-1)}><ChevronLeftIcon /> Previous</Button>
          <Button disabled={selectedIndex < 0 || selectedIndex >= data.assignments.length - 1} onClick={() => selectOffset(1)}>Next <ChevronRightIcon /></Button>
        </div>
      </header>

      <div className={styles.columns}>
        <aside className={styles.assignmentRail}>
          <div className={styles.railHeader}>
            <strong>Your assignments</strong>
            <span>{completedCount} of {data.assignments.length} complete</span>
            <div className={styles.progressTrack}><span style={{ width: `${data.assignments.length ? (completedCount / data.assignments.length) * 100 : 0}%` }} /></div>
          </div>
          <nav className={styles.assignmentList} aria-label="Assigned submissions">
            {data.assignments.map((assignment, index) => {
              const id = String(assignment.id);
              const localScores = scores[id];
              const complete = localScores ? scoreIsComplete(localScores) : Boolean(assignment.review?.completed);
              const active = id === selectedId;
              return (
                <button className={active ? styles.assignmentActive : styles.assignmentButton} key={id} onClick={() => setSelectedId(id)} type="button">
                  <span className={styles.assignmentNumber}>{index + 1}</span>
                  <span className={styles.assignmentText}><strong>{assignment.demoTitle}</strong><small>{assignment.name}</small></span>
                  {complete ? <CheckCircle2Icon className={styles.completeIcon} /> : <CircleIcon className={styles.incompleteIcon} />}
                </button>
              );
            })}
          </nav>
          <p className={styles.shortcutHint}>Press <kbd>J</kbd> <kbd>K</kbd> to navigate</p>
        </aside>

        {selected ? <ProjectReviewContent project={selected} /> : <p className={styles.emptyCopy}>No submissions are assigned to this judge.</p>}

        <aside className={styles.scorePanel}>
          <div className={styles.scoreHeading}>
            <div><h2>Score this project</h2><p>Score each criterion from 0 to 10.</p></div>
            <span className={saveStateClass} role="status">
              {currentSaveState === "saving" ? "Saving…" : currentSaveState === "error" ? "Could not save" : currentSaveState === "saved" || currentComplete ? "Saved" : "Not started"}
            </span>
          </div>
          {isClosed ? <div className={styles.closedNotice}>Scores are read-only because judging is closed.</div> : null}
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
                        disabled={!isOpen || !selected}
                        key={value}
                        onClick={() => selected && void updateScore(String(selected.id), criterion, String(value))}
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
          <Button className={styles.nextProject} disabled={selectedIndex < 0 || selectedIndex >= data.assignments.length - 1} onClick={() => selectOffset(1)}>Next project <ChevronRightIcon /></Button>
        </aside>
      </div>
    </main>
  );
}
