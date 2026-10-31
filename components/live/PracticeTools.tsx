"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCommands, type Command, ShortcutTooltip } from "@/components/shell/commands";
import { absoluteUrl, submissionPath } from "@/lib/routes";
import { errorText } from "./changes";
import type { AdminData } from "./PhaseTabs";
import { Toggle } from "./Toggle";
import styles from "./live.module.css";

async function attempt<T>(action: () => Promise<T>, failure: string) {
  try { return await action(); } catch (error) { toast.error(errorText(error, failure)); return undefined; }
}

/**
 * Practice tools: each one goes through the same path a real person would
 * (the submit code, the judge's own link, the real timers).
 */
export function PracticeTools({ slug, admin }: { slug: string; admin: AdminData }) {
  const addPracticeSubmissions = useMutation(api.practice.addPracticeSubmissions);
  const scoreAsTestJudges = useMutation(api.practice.scoreAsTestJudges);
  const skipTimerToLastSeconds = useMutation(api.practice.skipTimerToLastSeconds);
  const setPracticeAiSummaries = useMutation(api.practice.setPracticeAiSummaries);
  const hackathon = admin.event.eventType === "hackathon";
  const overview = useQuery(api.judging.getJudgesOverview, hackathon ? { slug } : "skip");
  const [busy, setBusy] = useState(false);
  const judge = overview?.judges.find((row) => row.active && row.path);
  const submitUrl = absoluteUrl(submissionPath(slug));
  const judging = admin.event.judgingStatus === "open";
  const realModel = admin.event.practice?.aiSummaries === "model";

  async function add(count: number) {
    setBusy(true);
    const result = await attempt(() => addPracticeSubmissions({ slug, count }), "Could not add test submissions.");
    setBusy(false);
    if (result) toast(`Added ${count} test submission${count === 1 ? "" : "s"}`);
  }
  async function score(limit?: number) {
    setBusy(true);
    const result = await attempt(() => scoreAsTestJudges({ slug, limit }), "Could not score as test judges.");
    setBusy(false);
    if (result) toast(`Scored ${result.scored} review${result.scored === 1 ? "" : "s"} as test judges`);
  }
  async function setRealModel(on: boolean) {
    setBusy(true);
    const result = await attempt(() => setPracticeAiSummaries({ slug, mode: on ? "model" : "sample" }), "Could not change the AI summaries.");
    setBusy(false);
    if (result) toast(on ? "AI summaries now use the real model" : "AI summaries are samples again");
  }
  async function skip() {
    const result = await attempt(() => skipTimerToLastSeconds({ slug }), "No timer is running to skip.");
    if (result) toast("Skipped to the last 10 seconds");
  }

  const commands = useMemo<Command[]>(() => [
    { id: "practice-add-5", group: "This page", label: "Add 5 test submissions", disabled: !admin.event.submissionsOpen, run: () => void add(5) },
    { id: "practice-add-20", group: "This page", label: "Add 20 test submissions", disabled: !admin.event.submissionsOpen, run: () => void add(20) },
    ...(hackathon ? [{ id: "practice-score", group: "This page", label: "Score the rest as test judges", disabled: !judging, run: () => void score() }] : []),
    { id: "practice-skip", group: "This page", label: "Skip to the last 10 seconds", keys: ["⇧T"], run: () => void skip() },
  ], [hackathon, judging, admin.event.submissionsOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useCommands("practice-tools", commands);

  return <section className={styles.section} aria-labelledby="practice-tools">
    <div className={styles.sectionHead}><h2 id="practice-tools">Practice tools</h2><span className={styles.hint}>each one goes through the same path a real person would</span></div>
    <div className={styles.tools}>
      <div className={styles.tool}>
        <h3>Add submissions</h3>
        <p>{admin.event.submissionsOpen ? "Sent through the real submit code, with random tracks and team members." : "Submissions are closed. Move back to Submissions to add more."}</p>
        <div className={styles.toolActions}>{[5, 20, 50].map((count) => <Button key={count} variant="outline" size="sm" disabled={busy || !admin.event.submissionsOpen} onClick={() => void add(count)}>+{count}</Button>)}</div>
      </div>
      {hackathon && <div className={styles.tool}>
        <h3>Score as test judges</h3>
        <p>{judging ? "Each test judge scores through their own judge link." : "Opens once judging has started."}</p>
        <div className={styles.toolActions}>
          <Button variant="outline" size="sm" disabled={busy || !judging} onClick={() => void score(5)}>Score 5</Button>
          <Button variant="outline" size="sm" disabled={busy || !judging} onClick={() => void score()}>Score the rest</Button>
        </div>
      </div>}
      {hackathon && <div className={styles.tool}>
        <h3>AI summaries</h3>
        <p id="practice-ai-detail">{realModel ? "Written by the real model, with the normal limits. Costs money per project." : "Sample summaries from each description. No model call, no cost."}</p>
        <div className={styles.toolActions}>
          <Toggle label="Write AI summaries with the real model" checked={realModel} disabled={busy} describedBy="practice-ai-detail" onChange={(on) => setRealModel(on)} />
        </div>
      </div>}
      <div className={styles.tool}>
        <h3>Skip ahead</h3>
        <p>Jump the running timer so you can see what happens at zero.</p>
        <div className={styles.toolActions}>
          <ShortcutTooltip label="Skip to the last 10 seconds" keys={["⇧", "T"]}><Button variant="outline" size="sm" onClick={() => void skip()}>Last 10 seconds</Button></ShortcutTooltip>
        </div>
      </div>
      <div className={styles.tool}>
        <h3>Try it on your phone</h3>
        <p>Scan to submit as a real person would, from your own phone.</p>
        <div className={styles.toolQr}>
          <QRCodeSVG value={submitUrl} size={72} marginSize={1} aria-label="QR code for the submit link" role="img" />
          {judge?.path ? <a className={styles.linkButton} href={judge.path} target="_blank" rel="noreferrer">or open the judge link for {judge.judgeName}</a> : <a className={styles.linkButton} href={submitUrl} target="_blank" rel="noreferrer">or open the submit form here</a>}
        </div>
      </div>
    </div>
  </section>;
}

/** The yellow bar on every page of a practice event, with Reset to the start. */
export function PracticeBar({ slug }: { slug: string }) {
  const resetPracticeEvent = useMutation(api.practice.resetPracticeEvent);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function reset(keepSubmissions: boolean) {
    setBusy(true);
    const result = await attempt(() => resetPracticeEvent({ slug, keepSubmissions }), "Could not reset the practice event.");
    setBusy(false);
    if (result) { setOpen(false); toast(keepSubmissions ? "Back to the start, test submissions kept" : "Back to the start, submissions removed"); }
  }
  const commands = useMemo<Command[]>(() => [{ id: "practice-reset", group: "This page", label: "Reset the practice event to the start", run: () => setOpen(true) }], []);
  useCommands("practice-bar", commands);
  return <>
    <div className={styles.practiceBar} role="note">
      <span className="dq-practice-badge">Practice</span>
      <span>Same code as a real event. Only test people, and their emails come to you.</span>
      <button type="button" className={styles.linkButton} style={{ color: "inherit", textDecoration: "underline" }} onClick={() => setOpen(true)}>Reset to the start</button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset to the start?</DialogTitle>
          <DialogDescription>The event goes back to Submissions. Scores, judging and the lineup are cleared, and timers start again. This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="outline" onClick={() => void reset(false)} disabled={busy}>Reset and remove submissions</Button>
          <Button onClick={() => void reset(true)} disabled={busy}>Reset, keep test submissions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
