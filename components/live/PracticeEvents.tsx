"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCommands, type Command } from "@/components/shell/commands";
import { WorkspaceOrganizationContext } from "@/components/WorkspaceOrganizationContext";
import { PHASE_LABELS } from "@/lib/event-phase";
import { adminPath } from "@/lib/routes";
import { errorText, useMemberNames } from "./changes";
import { Toggle } from "./Toggle";
import styles from "./practice.module.css";

type Start = "copy" | "hackathon" | "demo";

/** Practice: real events with test people. Never in Events, never the live event. */
export function PracticeEvents() {
  const organizationId = useContext(WorkspaceOrganizationContext);
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.practice.listPracticeEvents, isAuthenticated ? {} : "skip");
  const names = useMemberNames();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const creating = search.get("new") === "1";
  const setCreating = (open: boolean) => router.replace(open ? `${pathname}?new=1` : pathname, { scroll: false });
  const commands = useMemo<Command[]>(() => [{ id: "practice-new", group: "This page", label: "New practice event", keys: ["N"], run: () => setCreating(true) }], []); // eslint-disable-line react-hooks/exhaustive-deps
  useCommands("practice-list", commands, "Practice");

  return <>
    <title>Practice | Demo Queue</title>
    <div className={styles.heading}>
      <div><h1>Practice</h1><p>Real events with test people. Never in Events, never the live event.</p></div>
      <Button onClick={() => setCreating(true)}>New practice event</Button>
    </div>
    <div className="dq-card overflow-x-auto">
      <table className={styles.table}>
        <thead><tr><th>Name</th><th>Copied from</th><th>Owner</th><th>Phase</th><th className="text-right">Tidies away</th></tr></thead>
        <tbody>
          {rows === undefined ? [0, 1, 2].map((key) => <tr key={key} aria-hidden><td><Skeleton className="h-3 w-40" /></td><td><Skeleton className="h-3 w-24" /></td><td><Skeleton className="h-3 w-20" /></td><td><Skeleton className="h-3 w-16" /></td><td><Skeleton className="ml-auto h-3 w-16" /></td></tr>)
            : rows.length === 0 ? <tr><td colSpan={5} className={styles.empty}>No practice events yet. Make one to run the night end to end with test people, before the real one.<div className="mt-3"><Button size="sm" variant="outline" onClick={() => setCreating(true)}>New practice event</Button></div></td></tr>
            : rows.map((row) => <tr key={row.id} className={styles.row} onClick={() => router.push(adminPath(row.slug))}>
              <td><Link href={adminPath(row.slug)} className={styles.name} onClick={(clickEvent) => clickEvent.stopPropagation()}>{row.name}</Link></td>
              <td className={styles.muted}>{row.copiedFromName ?? (row.eventType === "hackathon" ? "Blank hackathon" : "Blank demo night")}</td>
              <td className={styles.muted}>{row.isYours ? "You" : (row.ownerUserId && names[row.ownerUserId]) || "A teammate"}</td>
              <td><span className="dq-pill-tab" data-active="">{PHASE_LABELS[row.phase]}</span></td>
              <td className={`${styles.muted} text-right`}>{daysLeft(row.tidiesAwayAt)}</td>
            </tr>)}
        </tbody>
      </table>
    </div>
    <p className={styles.note}>Everyone in your organization can open these, but they only show here. Nothing in a practice event reaches real participants: every test person uses a plus-address of the owner&apos;s own email.</p>
    {organizationId && <NewPracticeDialog open={creating} onOpenChange={setCreating} organizationId={organizationId} />}
  </>;
}

function daysLeft(at: number) {
  const days = Math.max(0, Math.ceil((at - Date.now()) / 86_400_000));
  return days === 0 ? "Today" : days === 1 ? "In 1 day" : `In ${days} days`;
}

function NewPracticeDialog({ open, onOpenChange, organizationId }: { open: boolean; onOpenChange: (open: boolean) => void; organizationId: string }) {
  const live = useQuery(api.events.getLiveEvent, open ? {} : "skip");
  const createPracticeEvent = useAction(api.practice.createPracticeEvent);
  const router = useRouter();
  const [start, setStart] = useState<Start>("copy");
  const [name, setName] = useState("");
  const [submissions, setSubmissions] = useState(20);
  const [judges, setJudges] = useState(3);
  // Off by default: the real model costs money per project.
  const [realModel, setRealModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startFrom: Start = start === "copy" && live === null ? "hackathon" : start;
  const judged = startFrom === "hackathon" || (startFrom === "copy" && live?.eventType === "hackathon");
  useEffect(() => { if (open) setError(""); }, [open]);

  async function create() {
    if (startFrom === "copy" && !live) return;
    setBusy(true); setError("");
    try {
      const result = await createPracticeEvent({
        expectedOrganizationId: organizationId,
        start: startFrom === "copy" ? { kind: "copy", slug: live!.slug } : { kind: "blank", eventType: startFrom },
        name: name.trim() || undefined,
        testSubmissions: submissions,
        testJudges: judged ? judges : 0,
        practiceAiSummaries: judged && realModel ? "model" : "sample",
      });
      toast(`Made ${result.submissionCount} test submission${result.submissionCount === 1 ? "" : "s"}${result.judges.length ? ` and ${result.judges.length} test judges` : ""}`);
      router.push(adminPath(result.slug));
    } catch (failure) {
      setError(errorText(failure, "Could not make the practice event."));
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-[400px]">
      <DialogHeader><DialogTitle>New practice event</DialogTitle><DialogDescription className="sr-only">Choose what to start from and how many test people to fill it with.</DialogDescription></DialogHeader>
      <form className={styles.form} onSubmit={(submitEvent) => { submitEvent.preventDefault(); void create(); }}>
        <fieldset>
          <legend className={styles.legend}>Start from</legend>
          <RadioGroup value={startFrom} onValueChange={(value) => setStart(value as Start)} className={styles.options}>
            <label className={styles.option} data-disabled={live === null ? "" : undefined}>
              <RadioGroupItem value="copy" disabled={!live} />
              <span><span className={styles.optionTitle}>{live === undefined ? "Copy the live event" : live ? `Copy ${live.name}` : "Copy the live event"}</span><span className={styles.optionDetail}>{live === null ? "There is no live event to copy." : "Its tracks, style, rules, timers and judging setup."}</span></span>
            </label>
            <label className={styles.option}><RadioGroupItem value="hackathon" /><span><span className={styles.optionTitle}>Blank hackathon</span><span className={styles.optionDetail}>Tracks and judging, nothing filled in.</span></span></label>
            <label className={styles.option}><RadioGroupItem value="demo" /><span><span className={styles.optionTitle}>Blank demo night</span><span className={styles.optionDetail}>A queue of demos, no judging.</span></span></label>
          </RadioGroup>
        </fieldset>
        <label className={styles.field}><span className={styles.legend}>Name</span><Input value={name} maxLength={80} placeholder={live && startFrom === "copy" ? `Dry run for ${live.name}` : "Dry run"} onChange={(changeEvent) => setName(changeEvent.currentTarget.value)} /></label>
        <fieldset>
          <legend className={styles.legend}>Fill it with</legend>
          <Stepper label="Test submissions" value={submissions} min={0} max={50} step={5} onChange={setSubmissions} />
          {judged && <Stepper label="Test judges" value={judges} min={0} max={10} skip={1} onChange={setJudges} />}
        </fieldset>
        {judged && <div className={styles.field}>
          <Toggle label="Write AI summaries with the real model" checked={realModel} describedBy="practice-ai-hint" onChange={setRealModel} />
          <span id="practice-ai-hint" className={styles.note}>Costs money per project. Off uses sample summaries.</span>
        </div>}
        <p className={styles.note}>Test people get the event&apos;s tracks at random, a third of them none. Their confirmation emails arrive in your inbox.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || (startFrom === "copy" && !live)}>{busy ? "Making it…" : "Create and open"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

/** − n + for a count. `skip` is a value it jumps over (test judges are 0, or 2 to 10). */
function Stepper({ label, value, min, max, step = 1, skip, onChange }: { label: string; value: number; min: number; max: number; step?: number; skip?: number; onChange: (value: number) => void }) {
  const move = (direction: 1 | -1) => {
    let next = Math.max(min, Math.min(max, value + direction * step));
    if (next === skip) next = Math.max(min, Math.min(max, next + direction));
    onChange(next);
  };
  return <div className={styles.stepper}>
    <span>{label}</span>
    <span className={styles.stepperControl} role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => move(-1)}><Minus aria-hidden /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => move(1)}><Plus aria-hidden /></button>
    </span>
  </div>;
}
