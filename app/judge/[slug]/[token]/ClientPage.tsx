"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Brand } from "@/app/Brand";
import { Skeleton } from "@/app/Skeleton";
import { JUDGING_CRITERIA, JUDGING_CRITERION_LABELS } from "@/lib/judging-rubric";
import { Id } from "../../../../convex/_generated/dataModel";
import styles from "./judge.module.css";

type Criterion = (typeof JUDGING_CRITERIA)[number];

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
  const data = useQuery(api.judging.getMyAssignments, { slug: params.slug, capabilityToken: params.token });
  const saveReview = useMutation(api.judging.saveReview);
  const [scores, setScores] = useState<Record<string, Partial<Record<Criterion, number>>>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
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
        ) as Partial<Record<Criterion, number>>;
      }
      return next;
    });
  }, [data]);

  const completedCount = useMemo(
    () => data?.assignments.filter((assignment) => assignment.review?.completed).length ?? 0,
    [data],
  );

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
    return <main className="narrow-page"><section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}><Skeleton w={120} h={12} /><Skeleton w="60%" h={38} style={{ marginTop: 18 }} /><Skeleton h={140} style={{ marginTop: 22 }} /></section></main>;
  }

  const isOpen = data.judgingStatus === "open";
  const isClosed = data.judgingStatus === "closed";
  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(820px, 100%)" }}>
        <Brand label="Private judge link" />
        <h1>{data.eventName}</h1>
        <p className="lead">Judge workspace for {data.judgeName}. Your scores are private.</p>
        {!isOpen ? (
          <div className={styles.notice} role="status">
            <strong>{isClosed ? "Judging is closed" : "Judging has not opened yet"}</strong>
            <span>{isClosed ? "Your saved scores are read-only." : "The event team will open your assignments when everything is ready."}</span>
          </div>
        ) : null}
        {isOpen ? (
          <div className={styles.toolbar}>
            <span><strong>{completedCount}</strong> of {data.assignments.length} reviews complete</span>
            <span className={remainingMs < 0 ? `${styles.timer} ${styles.timerOvertime}` : styles.timer}>{formatTimer(remainingMs)}</span>
          </div>
        ) : null}
        {isOpen || isClosed ? (
          <div className={styles.assignments}>
            {data.assignments.map((assignment) => {
              const id = String(assignment.id);
              const review = scores[id] ?? {};
              const state = saveState[id];
              return (
                <article className={styles.assignment} key={id}>
                  <div className={styles.assignmentHeading}>
                    <div><h2>{assignment.demoTitle}</h2><p>{assignment.name}{assignment.category ? ` · ${assignment.category}` : ""}</p></div>
                    <span className={styles.saveState} role="status">{state === "saving" ? "Saving…" : state === "error" ? "Error saving" : state === "saved" ? "Saved" : assignment.review?.completed ? "Saved" : "Not started"}</span>
                  </div>
                  <p className={styles.description}>{assignment.description}</p>
                  <div className={styles.scoreGrid}>
                    {JUDGING_CRITERIA.map((criterion) => (
                      <label key={criterion}>
                        <span>{JUDGING_CRITERION_LABELS[criterion]}</span>
                        <select disabled={!isOpen} value={review[criterion] ?? ""} onChange={(event) => void updateScore(id, criterion, event.target.value)}>
                          <option value="">Select 0–10</option>
                          {Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
