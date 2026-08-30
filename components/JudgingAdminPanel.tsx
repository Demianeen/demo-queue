"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { randomToken } from "@/lib/tokens";
import { absoluteUrl } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { JUDGING_CRITERIA, JUDGING_CRITERION_LABELS } from "@/lib/judging-rubric";
import { DndContext, closestCenter, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./JudgingAdminPanel.module.css";

function formatTimer(ms: number) {
  const seconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absolute = Math.abs(seconds);
  return `${seconds < 0 ? "-" : ""}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

function judgeKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function JudgingAdminPanel({ slug, adminToken, judges }: { slug: string; adminToken: string; judges: string[] }) {
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
  const decision = useQuery(api.judging.getFinalistDecision, { slug, adminToken });
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
  const links = useMemo(() => new Map((access ?? []).map((item) => [item.judgeKey, item])), [access]);
  const unavailableJudgeName = access?.find((item) => item.judgeKey === unavailableJudge)?.judgeName;

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await action(); setMessage(label); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); } finally { setBusy(false); }
  }
  async function prepare() {
    await run("Assignments are ready.", async () => {
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
      <div className={styles.heading}><div><h2 id="judging-admin-title">Hackathon judging</h2><p>Private judge links, progress, and raw scores.</p></div><span className={styles.status}>{progress?.eventStatus ?? "Loading…"}</span></div>
      <div className={styles.actions}>
        <Button variant="outline" disabled={busy || Boolean(progress?.submissionsClosedAt)} onClick={() => void run("Submissions closed.", () => closeSubmissions({ slug, adminToken }))}>{progress?.submissionsClosedAt ? "Submissions closed" : "Close submissions"}</Button>
        <Button variant="outline" disabled={busy || !progress?.submissionsClosedAt || progress?.eventStatus !== "setup"} onClick={() => void prepare()}>Prepare assignments</Button>
        {progress?.eventStatus === "ready" ? <Button disabled={busy} onClick={() => void run("Judging opened.", () => startJudging({ slug, adminToken }))}>Open judging</Button> : null}
        {progress?.eventStatus === "open" ? <Button variant="outline" disabled={busy} onClick={() => void run("Judging closed.", () => closeJudging({ slug, adminToken }))}>Close judging</Button> : null}
        {progress?.eventStatus === "closed" ? <Button variant="outline" disabled={busy} onClick={() => void run("Judging reopened.", () => reopenJudging({ slug, adminToken }))}>Reopen judging</Button> : null}
      </div>
      <div className={styles.grid}>
        <div className={styles.card}><h3>Judge links</h3><p className={styles.help}>Create one private link per roster judge.</p>{judges.map((judge) => { const item = links.get(judgeKey(judge)); return <div className={styles.row} key={judge}><span>{judge}</span>{item ? <Button size="sm" variant="outline" onClick={() => void copyLink(item.judgeKey, item.token)}>Copy link</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void makeLink(judge)}>Create link</Button>}</div>; })}</div>
        <div className={styles.card}><h3>Timer</h3><div className={remaining < 0 ? `${styles.timer} ${styles.overtime}` : styles.timer}>{formatTimer(remaining)}</div><div className={styles.timerActions}><input aria-label="Judging minutes" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, "").slice(0, 3))} /><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("Timer saved.", () => setTimer({ slug, adminToken, durationMs: Math.max(1, Number(minutes)) * 60_000 }))}>Set minutes</Button><Button size="sm" variant="outline" disabled={busy || progress?.eventStatus !== "open"} onClick={() => void run("Added 5 minutes.", () => addTime({ slug, adminToken, deltaMs: 5 * 60_000 }))}>+5 min</Button></div></div>
      </div>
      <div className={styles.card}><h3>Coverage</h3><p className={styles.help}>{complete} of {progress?.totalSubmissions ?? 0} submissions have at least one complete review. Two reviews are the target.</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Submission</th><th>Complete reviews</th><th>Status</th></tr></thead><tbody>{progress?.scoring.map((row) => <tr key={String(row.submissionId)}><td>{row.demoTitle}</td><td>{row.completeReviewCount}</td><td>{row.warning ?? "Ready"}</td></tr>)}</tbody></table></div></div>
      <div className={styles.card}><h3>Raw scores</h3><p className={styles.help}>Visible only to the event admin, including after judging closes.</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Judge</th><th>Submission</th>{JUDGING_CRITERIA.map((criterion) => <th key={criterion}>{JUDGING_CRITERION_LABELS[criterion]}</th>)}</tr></thead><tbody>{progress?.reviews.length ? progress.reviews.map((review, index) => <tr key={`${review.submissionId}-${review.judgeKey}-${index}`}><td>{review.judgeName}</td><td>{progress.scoring.find((row) => String(row.submissionId) === String(review.submissionId))?.demoTitle ?? "Submission"}</td><td>{review.innovation ?? "—"}</td><td>{review.execution ?? "—"}</td><td>{review.demoClarity ?? "—"}</td></tr>) : <tr><td colSpan={5}>No scores saved yet.</td></tr>}</tbody></table></div></div>
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
      <NormalizationSection slug={slug} adminToken={adminToken} overview={normalization} saveDecision={saveNormalization} />
      <DecisionSection
        slug={slug}
        adminToken={adminToken}
        decision={decision}
        saveFinalistDraft={saveFinalistDraft}
        submitFinalists={submitFinalists}
        savePlacementDraft={savePlacementDraft}
        submitPlacements={submitPlacements}
      />
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

function NormalizationSection({ slug, adminToken, overview, saveDecision }: { slug: string; adminToken: string; overview: any; saveDecision: (args: any) => Promise<unknown> }) {
  if (!overview || overview.judgingStatus !== "closed") return null;
 return <div className={styles.card}><div className={styles.sectionHeading}><div><h3>Score normalization</h3><p className={styles.help}>Choose how each judge&apos;s complete reviews should count.</p></div><span className={styles.status}>{overview.scoreBasisReady ? "Ready" : "Needs decisions"}</span></div>{overview.judges.filter((judge: any) => judge.completeReviewCount > 0).map((judge: any) => <div className={styles.normalizationCard} key={judge.judgeKey}><div className={styles.row}><strong>{judge.judgeName}</strong><span>{judge.completeReviewCount} complete review{judge.completeReviewCount === 1 ? "" : "s"}{judge.lowData ? " · Low data" : ""}</span></div>{judge.lowData ? <p className={styles.warning}>Fewer than 5 complete reviews. You can still choose an adjustment.</p> : null}<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Demo</th><th>Raw avg</th><th>Delta (I/E/D)</th><th>Unclamped (I/E/D)</th><th>Clamped (I/E/D)</th><th>Adjusted avg</th></tr></thead><tbody>{judge.reviews.map((review: any) => <tr key={String(review.submissionId)}><td>{review.demoTitle}</td><td>{review.rawAverage.toFixed(2)}</td><td>{JUDGING_CRITERIA.map((criterion) => <span key={criterion}>{review.delta?.[criterion]?.toFixed(2) ?? "0.00"} </span>)}</td><td>{JUDGING_CRITERIA.map((criterion) => <span key={criterion}>{review.unclamped?.[criterion]?.toFixed(2) ?? "—"} </span>)}</td><td>{JUDGING_CRITERIA.map((criterion) => <span key={criterion}>{review.clamped?.[criterion]?.toFixed(2) ?? "—"} </span>)}</td><td>{review.adjustedAverage.toFixed(2)}</td></tr>)}</tbody></table></div><div className={styles.actions}><span className={judge.decision ? (judge.decision.stale ? styles.warning : styles.help) : styles.warning}>{judge.decision ? (judge.decision.stale ? "Needs review" : `Using ${judge.decision.decision === "apply" ? "adjusted" : "raw"} scores`) : "Choose a score basis"}</span><Button size="sm" variant={judge.decision?.decision === "apply" && !judge.decision.stale ? "default" : "outline"} onClick={() => void saveDecision({ slug, adminToken, judgeKey: judge.judgeKey, decision: "apply" })}>Apply adjustment</Button><Button size="sm" variant={judge.decision?.decision === "raw" && !judge.decision.stale ? "default" : "outline"} onClick={() => void saveDecision({ slug, adminToken, judgeKey: judge.judgeKey, decision: "raw" })}>Keep raw</Button></div></div>)}</div>;
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
