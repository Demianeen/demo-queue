"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { randomToken } from "@/lib/tokens";
import { absoluteUrl, adminReviewPath } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SubmissionRowActions } from "@/components/SubmissionRowActions";
import { JUDGING_CRITERIA, JUDGING_CRITERION_LABELS } from "@/lib/judging-rubric";
import { DndContext, closestCenter, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./JudgingAdminPanel.module.css";

const SHOW_FINALIST_TOOLS = false;

function formatTimer(ms: number) {
  const seconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absolute = Math.abs(seconds);
  return `${seconds < 0 ? "-" : ""}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

function judgeKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

type ReviewValues = {
  innovation?: number;
  execution?: number;
  demoClarity?: number;
  completed: boolean;
};

type NormalizedReview = {
  raw: Record<(typeof JUDGING_CRITERIA)[number], number>;
  clamped: Record<(typeof JUDGING_CRITERIA)[number], number>;
};

function scoreAverage(review: ReviewValues | NormalizedReview["clamped"] | undefined) {
  if (!review) return null;
  const values = JUDGING_CRITERIA.map((criterion) => review[criterion]);
  return values.every((value) => value !== undefined)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length
    : null;
}

function JudgeReview({ judgeName, review, normalizedReview, useNormalized, onToggleNormalization, disabled, open, onOpenChange, lowData, completeReviewCount, popoverAlign }: {
  judgeName: string;
  review?: ReviewValues;
  normalizedReview?: NormalizedReview;
  useNormalized: boolean;
  onToggleNormalization: () => void;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lowData: boolean;
  completeReviewCount: number;
  popoverAlign: "start" | "end";
}) {
  const closeTimer = useRef<number | null>(null);
  const displayReview = useNormalized && normalizedReview ? normalizedReview.clamped : review;
  const average = review?.completed ? scoreAverage(displayReview) : null;
  const hasScores = JUDGING_CRITERIA.some((criterion) => review?.[criterion] !== undefined);
  const rawDescription = hasScores
    ? JUDGING_CRITERIA.map((criterion) => `${JUDGING_CRITERION_LABELS[criterion]} ${review?.[criterion] ?? "—"}`).join(" · ")
    : "No scores saved yet";
  const normalizedDescription = normalizedReview
    ? JUDGING_CRITERIA.map((criterion) => `${JUDGING_CRITERION_LABELS[criterion]} ${normalizedReview.clamped[criterion].toFixed(1)}`).join(" · ")
    : "";

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  function keepOpen() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    onOpenChange(true);
  }

  function scheduleClose() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => onOpenChange(false), 140);
  }

  const chipContent = (
    <>
      <span className={styles.judgeName}>{judgeName}</span>
      {hasScores ? JUDGING_CRITERIA.map((criterion) => {
        const rawValue = review?.[criterion];
        const displayValue = displayReview?.[criterion];
        const change = useNormalized && rawValue !== undefined && displayValue !== undefined
          ? displayValue - rawValue
          : 0;
        return (
          <span className={styles.judgeCriterion} key={criterion}>
            <span>{criterion === "innovation" ? "Innovation" : criterion === "execution" ? "Exec" : "Demo"}</span>
            <strong className={change > 0.005 ? styles.scoreRaised : change < -0.005 ? styles.scoreLowered : undefined}>
              {displayValue === undefined ? "—" : useNormalized ? displayValue.toFixed(1) : displayValue}
            </strong>
          </span>
        );
      }) : null}
      {average === null ? <span className={styles.reviewState}>{hasScores ? "In progress" : "Pending"}</span> : null}
    </>
  );

  if (!normalizedReview) {
    return (
      <Tooltip>
        <TooltipTrigger className={average === null ? styles.judgeReviewPending : styles.judgeReview} type="button">
          {chipContent}
        </TooltipTrigger>
        <TooltipContent>{rawDescription}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className={average === null ? styles.judgeReviewPending : styles.judgeReview}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        type="button"
      >
        {chipContent}
      </PopoverTrigger>
      <PopoverContent
        align={popoverAlign}
        className={styles.judgeScorePopover}
        initialFocus={false}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        side="top"
      >
        <div>
          <strong>{useNormalized ? "Original scores" : "Normalized scores"}</strong>
          <p>{useNormalized ? rawDescription : normalizedDescription}</p>
          {lowData ? <p className={styles.popoverWarning}>Limited data: based on {completeReviewCount} completed review{completeReviewCount === 1 ? "" : "s"}.</p> : null}
        </div>
        <Button
          disabled={disabled}
          onClick={() => {
            onToggleNormalization();
            onOpenChange(false);
          }}
          size="sm"
          variant="outline"
        >
          {useNormalized ? `Use raw values for ${judgeName}` : `Use normalized values for ${judgeName}`}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SubmissionScore({ score, rawScore, normalized }: { score: number | null; rawScore: number | null; normalized: boolean }) {
  if (score === null) return <span className={styles.mutedScore}>Not scored</span>;
  const change = rawScore === null ? 0 : score - rawScore;
  const value = <strong className={change > 0.005 ? styles.scoreRaised : change < -0.005 ? styles.scoreLowered : undefined}>{score.toFixed(2)}</strong>;
  if (!normalized || rawScore === null) return value;
  return (
    <Tooltip>
      <TooltipTrigger className={styles.scoreTrigger} type="button">{value}</TooltipTrigger>
      <TooltipContent>Original score: {rawScore.toFixed(2)}</TooltipContent>
    </Tooltip>
  );
}

export function JudgingAdminPanel({
  slug,
  adminToken,
  judges,
  lineupSubmissionIds,
  onAddToLineup,
  onRemoveFromLineup,
}: {
  slug: string;
  adminToken: string;
  judges: string[];
  lineupSubmissionIds: Id<"submissions">[];
  onAddToLineup: (submissionId: Id<"submissions">) => Promise<void>;
  onRemoveFromLineup: (submissionId: Id<"submissions">) => Promise<void>;
}) {
  const progress = useQuery(api.judging.getAdminProgress, { slug, adminToken });
  const access = useQuery(api.judging.listJudgeAccess, { slug, adminToken });
  const timer = useQuery(api.judging.getJudgingTimer, { slug, adminToken });
  const createAccess = useMutation(api.judging.createJudgeAccess);
  const closeSubmissions = useMutation(api.judging.closeSubmissions);
  const startPreparation = useMutation(api.judging.startAssignmentPreparation);
  const prepareBatch = useMutation(api.judging.prepareAssignmentBatch);
  const setTimer = useMutation(api.judging.setJudgingTimer);
  const startJudging = useMutation(api.judging.startJudging);
  const addTime = useMutation(api.judging.addJudgingTime);
  const closeJudging = useMutation(api.judging.closeJudging);
  const reopenJudging = useMutation(api.judging.reopenJudging);
  const applyRedistribution = useMutation(api.judging.applyRedistribution);
  const normalization = useQuery(api.judging.getNormalizationOverview, { slug, adminToken });
  const decision = useQuery(api.judging.getFinalistDecision, SHOW_FINALIST_TOOLS ? { slug, adminToken } : "skip");
  const saveNormalization = useMutation(api.judging.saveNormalizationDecision);
  const saveFinalistDraft = useMutation(api.judging.saveFinalistDraft);
  const submitFinalists = useMutation(api.judging.submitFinalists);
  const savePlacementDraft = useMutation(api.judging.savePlacementDraft);
  const submitPlacements = useMutation(api.judging.submitPlacements);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState("60");
  const [unavailableJudge, setUnavailableJudge] = useState("");
  const [redistributionOverrides, setRedistributionOverrides] = useState<Record<string, string[]>>({});
  const [openScorePopover, setOpenScorePopover] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const redistribution = useQuery(
    api.judging.previewRedistribution,
    unavailableJudge ? { slug, adminToken, unavailableJudgeKey: unavailableJudge } : "skip",
  );
  useEffect(() => {
    if (timer?.remainingMs === undefined) return;
    setNow(Date.now());
    if (timer.timerStatus !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer?.remainingMs, timer?.serverNow, timer?.timerStatus]);
  const remaining = timer?.timerStatus === "running" ? (timer.remainingMs - (now - (timer.serverNow ?? now))) : (timer?.remainingMs ?? 0);
  const complete = progress?.scoring.filter((row) => row.completeReviewCount > 0).length ?? 0;
  const lineupSubmissionKeys = useMemo(
    () => new Set(lineupSubmissionIds.map(String)),
    [lineupSubmissionIds],
  );
  const links = useMemo(
    () => new Map((access ?? []).filter((item) => item.active).map((item) => [item.judgeKey, item])),
    [access],
  );
  const reviewsByAssignment = useMemo(
    () => new Map((progress?.reviews ?? []).map((review) => [`${String(review.submissionId)}:${review.judgeKey}`, review])),
    [progress?.reviews],
  );
  const normalizedByAssignment = useMemo(() => {
    const map = new Map<string, { review: NormalizedReview; effectiveDecision: "apply" | "raw"; lowData: boolean; completeReviewCount: number }>();
    for (const judge of normalization?.judges ?? []) {
      for (const review of judge.reviews ?? []) {
        map.set(`${String(review.submissionId)}:${judge.judgeKey}`, {
          review,
          effectiveDecision: judge.effectiveDecision === "raw" ? "raw" : "apply",
          lowData: judge.lowData,
          completeReviewCount: judge.completeReviewCount,
        });
      }
    }
    return map;
  }, [normalization?.judges]);
  const scoringRows = useMemo(() => {
    const useClosedNormalization = progress?.eventStatus === "closed";
    return (progress?.scoring ?? []).map((row) => {
      const contributingScores = row.assignedJudges.flatMap((judgeName) => {
        const key = `${String(row.submissionId)}:${judgeKey(judgeName)}`;
        const review = reviewsByAssignment.get(key);
        if (!review?.completed) return [];
        const normalized = normalizedByAssignment.get(key);
        const effectiveReview = useClosedNormalization && normalized?.effectiveDecision === "apply"
          ? normalized.review.clamped
          : review;
        const reviewAverage = scoreAverage(effectiveReview);
        return reviewAverage === null ? [] : [reviewAverage];
      });
      const effectiveScore = contributingScores.length
        ? contributingScores.reduce((sum, score) => sum + score, 0) / contributingScores.length
        : null;
      return { ...row, effectiveScore };
    }).sort((left, right) => {
      if (left.effectiveScore === null && right.effectiveScore === null) return left.demoTitle.localeCompare(right.demoTitle);
      if (left.effectiveScore === null) return 1;
      if (right.effectiveScore === null) return -1;
      return right.effectiveScore - left.effectiveScore || left.demoTitle.localeCompare(right.demoTitle);
    });
  }, [normalizedByAssignment, progress?.eventStatus, progress?.scoring, reviewsByAssignment]);
  const unavailableJudgeName = access?.find((item) => item.judgeKey === unavailableJudge)?.judgeName;

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await action(); setMessage(label); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); } finally { setBusy(false); }
  }
  async function prepare() {
    await run("Submissions assigned. You can now open judging.", async () => {
      await startPreparation({ slug, adminToken });
      let done = false;
      while (!done) { const result = await prepareBatch({ slug, adminToken }); done = result.done; }
    });
  }
  async function makeLink(judgeName: string) {
    await run(`Private link ready for ${judgeName}.`, () => createAccess({ slug, adminToken, judgeName, capabilityToken: randomToken(32) }));
  }
  async function copyLink(judgeKey: string, token: string) {
    await navigator.clipboard.writeText(absoluteUrl(`/judge/${slug}/${token}`));
    setMessage("Private link copied.");
  }

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="judging-admin-title">
      <div className={styles.heading}><div><h2 id="judging-admin-title">Hackathon judging</h2><p>Private judge links, progress, and results.</p></div><span className={styles.status}>{progress?.eventStatus ?? "Loading…"}</span></div>
      <div className={styles.actions}>
        <Button variant="outline" disabled={busy || Boolean(progress?.submissionsClosedAt)} onClick={() => void run("Submissions closed.", () => closeSubmissions({ slug, adminToken }))}>{progress?.submissionsClosedAt ? "Submissions closed" : "Close submissions"}</Button>
        {progress?.eventStatus === "setup" || progress?.eventStatus === "preparing_assignments" ? <Button variant="outline" disabled={busy || !progress?.submissionsClosedAt || progress?.eventStatus !== "setup"} onClick={() => void prepare()}>{busy ? "Assigning..." : "Assign submissions"}</Button> : null}
        {progress?.eventStatus === "ready" ? <Button disabled={busy} onClick={() => void run("Judging opened.", () => startJudging({ slug, adminToken }))}>Open judging</Button> : null}
        {progress?.eventStatus === "open" ? <Button variant="outline" disabled={busy} onClick={() => void run("Judging closed.", () => closeJudging({ slug, adminToken }))}>Close judging</Button> : null}
        {progress?.eventStatus === "closed" ? <Button variant="outline" disabled={busy} onClick={() => void run("Judging reopened.", () => reopenJudging({ slug, adminToken }))}>Reopen judging</Button> : null}
      </div>
      <div className={styles.grid}>
        <div className={styles.card}><h3>Judge links</h3><p className={styles.help}>Create one private link per roster judge.</p>{judges.map((judge) => { const item = links.get(judgeKey(judge)); return <div className={styles.row} key={judge}><span>{judge}</span>{item ? <Button size="sm" variant="outline" onClick={() => void copyLink(item.judgeKey, item.token)}>Copy link</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void makeLink(judge)}>Create link</Button>}</div>; })}</div>
        <div className={styles.card}><h3>Timer</h3><div className={remaining < 0 ? `${styles.timer} ${styles.overtime}` : styles.timer}>{formatTimer(remaining)}</div><div className={styles.timerActions}><input aria-label="Judging minutes" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, "").slice(0, 3))} /><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("Timer saved.", () => setTimer({ slug, adminToken, durationMs: Math.max(1, Number(minutes)) * 60_000 }))}>Set minutes</Button><Button size="sm" variant="outline" disabled={busy || progress?.eventStatus !== "open"} onClick={() => void run("Added 5 minutes.", () => addTime({ slug, adminToken, deltaMs: 5 * 60_000 }))}>+5 min</Button></div></div>
      </div>
      <div className={styles.card}>
        <h3>Judging progress</h3>
        <p className={styles.help}>
          {progress?.eventStatus === "setup"
            ? "Assign submissions to distribute two judges per entry. Open judging only when the assignments look right."
            : progress?.eventStatus === "closed"
              ? `${complete} of ${progress?.totalSubmissions ?? 0} submissions have at least one complete review. Sorted by normalized score. Hover an adjusted value to see the original score.`
              : `${complete} of ${progress?.totalSubmissions ?? 0} submissions have at least one complete review. Started reviews show all three criteria.`}
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Submission</th><th>Judge reviews</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {scoringRows.map((row) => (
                <tr key={String(row.submissionId)}>
                  <td>
                    <div className={styles.submissionIdentity}>
                      <Link
                        className={styles.submissionLink}
                        href={adminReviewPath(slug, adminToken, String(row.submissionId))}
                      >
                        {row.demoTitle}
                      </Link>
                      <small className={styles.submissionPeople}>{row.teamMembers.join(", ")}</small>
                    </div>
                  </td>
                  <td>
                    {row.assignedJudges.length > 0 ? (
                      <div className={styles.judgeReviews}>
                        {row.assignedJudges.map((judgeName, judgeIndex) => {
                          const key = `${String(row.submissionId)}:${judgeKey(judgeName)}`;
                          const normalized = normalizedByAssignment.get(key);
                          return (
                            <JudgeReview
                              disabled={busy}
                              completeReviewCount={normalized?.completeReviewCount ?? 0}
                              judgeName={judgeName}
                              key={judgeName}
                              onOpenChange={(nextOpen) => setOpenScorePopover((current) =>
                                nextOpen ? key : current === key ? null : current,
                              )}
                              onToggleNormalization={() => void run(
                                normalized?.effectiveDecision === "apply"
                                  ? `${judgeName} now uses raw scores.`
                                  : `${judgeName} now uses normalized scores.`,
                                () => saveNormalization({
                                  slug,
                                  adminToken,
                                  judgeKey: judgeKey(judgeName),
                                  decision: normalized?.effectiveDecision === "apply" ? "raw" : "apply",
                                }),
                              )}
                              review={reviewsByAssignment.get(key)}
                              normalizedReview={normalized?.review}
                              open={openScorePopover === key}
                              lowData={normalized?.lowData ?? false}
                              popoverAlign={judgeIndex === 0 ? "end" : "start"}
                              useNormalized={progress?.eventStatus === "closed" && normalized?.effectiveDecision === "apply"}
                            />
                          );
                        })}
                      </div>
                    ) : "Not assigned"}
                  </td>
                  <td><SubmissionScore score={row.effectiveScore} rawScore={row.score} normalized={progress?.eventStatus === "closed"} /></td>
                  <td>{row.assignedJudges.length === 0 ? "Waiting for assignment" : `${row.completeReviewCount} of ${row.assignedJudges.length} complete`}</td>
                  <td>
                    <SubmissionRowActions
                      menuLabel={`More actions for ${row.demoTitle}`}
                      menuItems={[
                        lineupSubmissionKeys.has(String(row.submissionId))
                          ? {
                              label: "Remove from presenters",
                              onSelect: () => void run(
                                `${row.demoTitle} removed from presenters.`,
                                () => onRemoveFromLineup(row.submissionId),
                              ),
                            }
                          : {
                              label: "Add to presenters",
                              onSelect: () => void run(
                                `${row.demoTitle} added to presenters.`,
                                () => onAddToLineup(row.submissionId),
                              ),
                            },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={styles.card}>
        <h3>Redistribute an unavailable judge</h3>
        <div className={styles.timerActions}>
          <select
            aria-label="Unavailable judge"
            value={unavailableJudge}
            onChange={(event) => {
              setUnavailableJudge(event.target.value);
              setRedistributionOverrides({});
            }}
          >
            <option value="">Choose a judge</option>
            {(access ?? []).filter((item) => item.active).map((item) => <option key={item.judgeKey} value={item.judgeKey}>{item.judgeName}</option>)}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !redistribution || redistribution.length === 0}
            onClick={() => void run("Assignments redistributed.", async () => {
              await applyRedistribution({
                slug,
                adminToken,
                unavailableJudgeKey: unavailableJudge,
                assignments: (redistribution ?? []).map((item) => ({
                  submissionId: item.submissionId,
                  judges: redistributionOverrides[String(item.submissionId)] ?? item.judges,
                })),
              });
              setUnavailableJudge("");
              setRedistributionOverrides({});
            })}
          >
            Apply redistribution
          </Button>
        </div>
        {redistribution ? <p className={styles.help}>{redistribution.length} unfinished assignments will be reassigned. Completed reviews stay unchanged.</p> : null}
        {redistribution && redistribution.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Submission</th><th>Current judges</th><th>Replacement</th><th>Completed work</th></tr></thead>
              <tbody>
                {redistribution.map((item) => {
                  const keptJudge = item.previousJudges.find((judge) => judge !== unavailableJudgeName) ?? item.previousJudges[0];
                  const effectiveJudges = redistributionOverrides[String(item.submissionId)] ?? item.judges;
                  const selectedReplacement = effectiveJudges.find((judge) => judge !== keptJudge) ?? "";
                  return (
                    <tr key={String(item.submissionId)}>
                      <td>{progress?.scoring.find((row) => String(row.submissionId) === String(item.submissionId))?.demoTitle ?? "Submission"}</td>
                      <td>{item.previousJudges.join(" + ")}</td>
                      <td>
                        <select
                          aria-label="Replacement judge"
                          value={selectedReplacement}
                          onChange={(event) => {
                            const replacement = event.target.value;
                            setRedistributionOverrides((current) => ({
                              ...current,
                              [String(item.submissionId)]: item.previousJudges.map((judge) =>
                                judge === unavailableJudgeName ? replacement : judge,
                              ),
                            }));
                          }}
                        >
                          {(access ?? [])
                            .filter((candidate) => candidate.active && candidate.judgeKey !== unavailableJudge && candidate.judgeName !== keptJudge)
                            .map((candidate) => <option key={candidate.judgeKey} value={candidate.judgeName}>{candidate.judgeName}</option>)}
                        </select>
                      </td>
                      <td>{item.preservedCompletedJudge ? "Kept" : "None yet"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {SHOW_FINALIST_TOOLS ? (
        <DecisionSection
          slug={slug}
          adminToken={adminToken}
          decision={decision}
          saveFinalistDraft={saveFinalistDraft}
          submitFinalists={submitFinalists}
          savePlacementDraft={savePlacementDraft}
          submitPlacements={submitPlacements}
        />
      ) : null}
    </section>
  );
}

function SortableDecisionRow({ id, label, subdued, onRemove, onMove }: { id: string; label: string; subdued?: boolean; onRemove?: () => void; onMove: (direction: -1 | 1) => void }) {
  const sortable = useSortable({ id });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className={subdued ? styles.decisionRowSubdued : styles.decisionRow}><button type="button" className={styles.dragHandle} {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder ${label}`}>⠿</button><span>{label}</span><span className={styles.rowButtons}><Button size="sm" variant="ghost" onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>↑</Button><Button size="sm" variant="ghost" onClick={() => onMove(1)} aria-label={`Move ${label} down`}>↓</Button>{onRemove ? <Button size="sm" variant="outline" onClick={onRemove}>Remove</Button> : null}</span></div>;
}

function DraggableSubmissionRow({ id, children, subdued }: { id: string; children: ReactNode; subdued: boolean }) {
  const draggable = useDraggable({ id: `available:${id}` });
  return <div ref={draggable.setNodeRef} className={subdued ? styles.submissionSubdued : styles.submissionRow}>
    <button type="button" className={styles.dragHandle} {...draggable.attributes} {...draggable.listeners} aria-label="Drag submission into the draft">⠿</button>
    {children}
  </div>;
}

function DecisionDropZone({ id, children }: { id: string; children: ReactNode }) {
  const droppable = useDroppable({ id });
  return <div ref={droppable.setNodeRef}>{children}</div>;
}

function DecisionSection({ slug, adminToken, decision, saveFinalistDraft, submitFinalists, savePlacementDraft, submitPlacements }: { slug: string; adminToken: string; decision: any; saveFinalistDraft: (args: any) => Promise<unknown>; submitFinalists: (args: any) => Promise<unknown>; savePlacementDraft: (args: any) => Promise<unknown>; submitPlacements: (args: any) => Promise<unknown> }) {
  const [finalists, setFinalists] = useState<Id<"submissions">[]>([]);
  const [placements, setPlacements] = useState<Id<"submissions">[]>([]);
  const [mode, setMode] = useState<"finalists" | "placements">("finalists");
  const finalistKey = decision?.finalistIds.map(String).join(",") ?? "";
  const placementKey = decision?.placementIds.map(String).join(",") ?? "";

  useEffect(() => {
    if (!decision) return;
    setFinalists(decision.finalistIds);
  }, [decision, finalistKey]);
  useEffect(() => {
    if (!decision) return;
    setPlacements(decision.placementIds);
  }, [decision, placementKey]);
  useEffect(() => {
    if (decision?.finalistStatus !== "submitted") setMode("finalists");
  }, [decision?.finalistStatus]);

  if (!decision || decision.judgingStatus !== "closed" || !decision.scoreBasisReady) return null;
  const byId = new Map<string, { demoTitle: string }>(
    decision.submissions.map((item: any) => [String(item.submissionId), item]),
  );
  const active = mode === "finalists" ? finalists : placements;
  const visibleSubmissions = mode === "finalists"
    ? decision.submissions
    : decision.submissions.filter((item: any) =>
      finalists.some((id) => String(id) === String(item.submissionId)),
    );

  function setActive(next: Id<"submissions">[]) {
    if (mode === "finalists") {
      setFinalists(next);
      void saveFinalistDraft({ slug, adminToken, finalistIds: next });
    } else {
      setPlacements(next);
      void savePlacementDraft({ slug, adminToken, placementIds: next });
    }
  }

  function reorder(event: DragEndEvent) {
    if (!event.over) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (activeId.startsWith("available:")) {
      const submissionId = activeId.slice("available:".length) as Id<"submissions">;
      if (active.some((id) => String(id) === submissionId)) return;
      if (mode === "placements" && placements.length >= 3) return;
      const overIndex = active.findIndex((id) => String(id) === overId);
      const next = [...active];
      next.splice(overIndex >= 0 ? overIndex : next.length, 0, submissionId);
      setActive(next);
      return;
    }
    if (overId === "available-drop") {
      setActive(active.filter((id) => String(id) !== activeId));
      return;
    }
    const oldIndex = active.findIndex((id) => String(id) === activeId);
    const newIndex = active.findIndex((id) => String(id) === overId);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      setActive(arrayMove(active, oldIndex, newIndex));
    }
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= active.length) return;
    setActive(arrayMove(active, index, next));
  }

  return <div className={styles.card}>
    <div className={styles.sectionHeading}>
      <div>
        <h3>{mode === "finalists" ? "Finalists" : "Placements"}</h3>
        <p className={styles.help}>{mode === "finalists" ? "Select and order finalist submissions." : "Order up to three submitted finalists."}</p>
      </div>
      <span className={styles.status}>{mode === "finalists" ? `${decision.finalistStatus.replace("_", " ")} · v${decision.finalistVersion}` : `${decision.placementStatus.replace("_", " ")} · v${decision.placementVersion}`}</span>
    </div>
    <div className={styles.modeButtons}>
      <Button size="sm" variant={mode === "finalists" ? "default" : "outline"} onClick={() => setMode("finalists")}>Finalists</Button>
      <Button size="sm" variant={mode === "placements" ? "default" : "outline"} disabled={decision.finalistStatus !== "submitted"} onClick={() => setMode("placements")}>Placements</Button>
    </div>
    <DndContext collisionDetection={closestCenter} onDragEnd={reorder}>
      <div className={styles.decisionBoard}>
        <DecisionDropZone id="available-drop">
          <strong>{mode === "finalists" ? "All submissions" : "Submitted finalists"}</strong>
          {visibleSubmissions.map((item: any) => {
            const selected = active.some((id) => String(id) === String(item.submissionId));
            const scoreChanged = item.rawScore !== null && item.score !== null && Math.abs(item.rawScore - item.score) >= 0.005;
            const scoreLabel = item.score === null
              ? "No score"
              : scoreChanged
                ? `Raw ${item.rawScore.toFixed(2)} → Final ${item.score.toFixed(2)}`
                : `Score ${item.score.toFixed(2)}`;
            return <DraggableSubmissionRow id={String(item.submissionId)} subdued={selected} key={String(item.submissionId)}>
              <span>{item.demoTitle} · {scoreLabel}{item.warning ? ` · ${item.warning}` : ""}</span>
              {!selected && (mode === "finalists" || placements.length < 3) ? <Button size="sm" variant="outline" onClick={() => setActive([...active, item.submissionId])}>Add</Button> : null}
            </DraggableSubmissionRow>;
          })}
        </DecisionDropZone>
        <DecisionDropZone id="selected-drop">
          <strong>{mode === "finalists" ? "Finalist draft" : "Placement draft"}</strong>
          <SortableContext items={active.map(String)} strategy={verticalListSortingStrategy}>
            {active.map((id, index) => <SortableDecisionRow
              id={String(id)}
              label={mode === "placements" ? `${index + 1}. ${byId.get(String(id))?.demoTitle ?? "Submission"}` : byId.get(String(id))?.demoTitle ?? "Submission"}
              onMove={(direction) => move(index, direction)}
              onRemove={() => setActive(active.filter((candidate) => candidate !== id))}
              key={String(id)}
            />)}
          </SortableContext>
          {active.length === 0 ? <p className={styles.help}>Drag here or use Add.</p> : null}
          {mode === "placements" && active.length < 3 ? <p className={styles.help}>Choose from submitted finalists.</p> : null}
        </DecisionDropZone>
      </div>
    </DndContext>
    <div className={styles.actions}>
      {mode === "finalists" ? <Button onClick={() => void submitFinalists({ slug, adminToken, finalistIds: finalists })}>{decision.finalistVersion > 0 ? "Amend finalists" : "Submit finalists"}</Button> : <Button disabled={placements.length === 0} onClick={() => void submitPlacements({ slug, adminToken, placementIds: placements })}>{decision.placementVersion > 0 ? "Amend placements" : "Submit placements"}</Button>}
    </div>
  </div>;
}
