"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorText } from "@/components/live/changes";
import styles from "./judging.module.css";

/** A finished regenerate's result stays next to the button this long. */
const SHOW_RESULT_MS = 2 * 60 * 60_000;
/** Seconds between a regenerate's runs, as convex/aiSummaries.ts staggers them. */
const STAGGER_SECONDS = 10;

const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * "Regenerate AI summaries": one button for the whole event that rewrites
 * every project's AI summary with the current prompt, after a confirm with
 * the estimated cost. While it runs, how many are done, pending and failed.
 */
export function RegenerateSummaries({ slug }: { slug: string }) {
  const state = useQuery(api.aiSummaries.eventSummaryRegeneration, { slug });
  const regenerate = useMutation(api.aiSummaries.regenerateEventSummaries);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state || !state.configured) return null;
  const progress = state.progress;
  const recent = progress && (progress.running || Date.now() - progress.startedAt < SHOW_RESULT_MS);
  const status = !recent ? "" : progress.running
    ? `AI summaries: ${progress.done} of ${progress.total} done, ${progress.pending} pending${progress.failed ? `, ${progress.failed} failed` : ""}`
    : `AI summaries regenerated: ${progress.done} of ${progress.total}${progress.failed ? `, ${progress.failed} unchanged after a failure` : ""}`;
  const minutes = Math.max(1, Math.ceil((state.projects * STAGGER_SECONDS + 40) / 60));

  async function start() {
    setBusy(true);
    setError("");
    try {
      await regenerate({ slug });
      setOpen(false);
    } catch (failure) {
      setError(errorText(failure, "Could not start regenerating the AI summaries."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    {status && <span className={styles.sheetStatus} role="status" title={status}>{status}</span>}
    <Button variant="ghost" size="sm" onClick={() => { setError(""); setOpen(true); }} disabled={progress?.running || state.projects === 0}>
      <Sparkles aria-hidden />{progress?.running ? "Regenerating…" : "Regenerate AI summaries"}
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Regenerate AI summaries?</DialogTitle>
          <DialogDescription>
            Rewrites the AI summary of all {state.projects} project{state.projects === 1 ? "" : "s"} in judging with the current prompt, a few at a time (about {minutes} minute{minutes === 1 ? "" : "s"}).
            {state.sample ? " This practice event uses sample summaries, so it costs nothing." : ` Estimated cost: about ${usd(state.estimateUsd)} (about $0.17 a project).`}
            {" "}Judges keep seeing the current summary until its new one is saved. A project whose new summary fails keeps its old one.
          </DialogDescription>
        </DialogHeader>
        <p className={styles.sheetNote}>{state.leftToday > 0 ? `You can do this ${state.leftToday} more time${state.leftToday === 1 ? "" : "s"} today.` : "This was done 3 times today already; try again tomorrow."}</p>
        {error && <p role="alert" className={styles.sheetError}>{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void start()} disabled={busy || state.leftToday === 0}>{busy ? "Starting…" : `Regenerate ${state.projects}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
