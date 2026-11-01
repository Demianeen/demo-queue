"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { guideProgress, teamSummary, type TeamCounts } from "@/lib/getting-started";
import { captureEvent } from "@/lib/posthog-browser";
import { cn } from "@/lib/utils";

type EventSummary = { name: string; slug: string };
type Team = { kind: "loading" } | { kind: "ready"; counts: TeamCounts } | { kind: "error" };

function StepRow({ title, done, detail, action }: { title: string; done: boolean; detail?: ReactNode; action?: ReactNode }) {
  return <li className="ws-row items-start gap-3 py-3.5 max-sm:flex-wrap">
    <span className={cn("mt-px grid size-[18px] flex-none place-items-center rounded-full", done ? "bg-[var(--dq-accent)] text-white" : "border-[1.5px] border-[var(--dq-input)]")} aria-hidden>{done && <Check className="size-2.5" strokeWidth={3} />}</span>
    <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
      <p className={cn("m-0 font-medium", done && "text-[var(--dq-fg-3)] line-through")}>{title}<span className="sr-only">{done ? ", done" : ", not done"}</span></p>
      {detail && <div className="ws-sub">{detail}</div>}
    </div>
    {action && <div className="flex flex-wrap items-center gap-1.5 max-sm:pl-[30px]">{action}</div>}
  </li>;
}

const GUIDE_STEPS = ["first_event", "team", "mcp_connected", "style", "dry_run"];

/**
 * Reports each step that turns done while the guide is open, once per visit.
 * Steps already done on arrival are not counted, and a reload of the team
 * status starts the comparison again, so a team that was done all along is not
 * reported when its status finally loads.
 */
function StepCompletions({ steps, settled }: { steps: boolean[]; settled: boolean }) {
  const seen = useRef<boolean[] | null>(null);
  const reported = useRef(new Set<number>());
  const key = steps.map(Number).join("");
  useEffect(() => {
    if (!settled) { seen.current = null; return; }
    const now = [...key].map((done) => done === "1");
    seen.current?.forEach((done, index) => {
      if (done || !now[index] || reported.current.has(index)) return;
      reported.current.add(index);
      captureEvent("getting_started_step_completed", { step: GUIDE_STEPS[index] });
    });
    seen.current = now;
  }, [key, settled]);
  return null;
}

/** Skeleton shaped like the guide: header, progress bar and five rows. */
export function GettingStartedSkeleton() {
  return <section className="ws-card" aria-busy="true" aria-label="Loading getting started guide">
    <div className="ws-card-head h-12 gap-2.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-1.5 w-40 rounded-full" /></div>
    {Array.from({ length: 5 }, (_, index) => <div key={index} className="ws-row gap-3"><Skeleton className="size-[18px] rounded-full" /><div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-48 max-w-full" /><Skeleton className="h-3 w-72 max-w-full" /></div></div>)}
  </section>;
}

/** `alwaysOpen` is the Getting started page itself: it shows the guide even when it is hidden from Events. */
type GuideProps = { organizationName: string; events: EventSummary[]; styleCount: number; onCreateEvent: () => void; onOpenStyles: () => void; alwaysOpen?: boolean };

function GuideUnavailable({ onRetry }: { onRetry: () => void }) {
  return <Alert variant="destructive" className="flex flex-wrap items-center gap-3">
    <AlertDescription className="flex flex-wrap items-center gap-3">
      <span>Could not load the getting started guide. Your events are unaffected.</span>
      <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      <a className="text-sm underline underline-offset-4" href="/events/sign-in?returnTo=%2Fevents">Sign in again</a>
    </AlertDescription>
  </Alert>;
}

/** Keeps an unexpected render failure in the guide from taking the events list down with it. */
class GuideErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <GuideUnavailable onRetry={() => { this.setState({ failed: false }); this.props.onRetry(); }} />;
  }
}

export function GettingStarted(props: GuideProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((value) => value + 1);
  return <GuideErrorBoundary onRetry={retry}><Guide key={attempt} {...props} onRetry={retry} /></GuideErrorBoundary>;
}

type GuideStatus = FunctionReturnType<typeof api.gettingStarted.status>;

function Guide({ organizationName, events, styleCount, onCreateEvent, onOpenStyles, alwaysOpen = false, onRetry }: GuideProps & { onRetry: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  // A failed query comes back as an Error instead of being thrown during render. A query error thrown
  // from a hook leaves React with a half-rendered Guide, and the next navigation away from /events
  // then crashed with "Rendered more hooks than during the previous render" (React error 310).
  // The request must keep its identity between renders: useQueries resubscribes whenever it changes.
  const request = useMemo(() => {
    const queries: Parameters<typeof useQueries>[0] = {};
    if (isAuthenticated) queries.status = { query: api.gettingStarted.status, args: {} };
    return queries;
  }, [isAuthenticated]);
  const result = useQueries(request).status as GuideStatus | Error | undefined;
  const failed = result instanceof Error;
  const status = failed ? undefined : result;
  const setHidden = useMutation(api.gettingStarted.setHidden).withOptimisticUpdate((store, { hidden }) => {
    const current = store.getQuery(api.gettingStarted.status, {});
    if (current) store.setQuery(api.gettingStarted.status, {}, { ...current, hidden });
  });
  const markDryRun = useMutation(api.gettingStarted.markDryRun).withOptimisticUpdate((store, { done }) => {
    const current = store.getQuery(api.gettingStarted.status, {});
    if (current) store.setQuery(api.gettingStarted.status, {}, { ...current, dryRunMarked: done });
  });
  const skipTeam = useMutation(api.gettingStarted.skipTeam).withOptimisticUpdate((store, { skipped }) => {
    const current = store.getQuery(api.gettingStarted.status, {});
    if (current) store.setQuery(api.gettingStarted.status, {}, { ...current, teamSkipped: skipped });
  });
  const loadTeam = useAction(api.gettingStarted.teamStatus);
  const [team, setTeam] = useState<Team>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"hide" | "show" | "dry-run" | "team" | null>(null);

  const loaded = status !== undefined;
  const hidden = (status?.hidden ?? false) && !alwaysOpen;
  useEffect(() => {
    if (!isAuthenticated || !loaded || hidden) return;
    let current = true;
    setTeam({ kind: "loading" });
    loadTeam({}).then((counts) => { if (current) setTeam({ kind: "ready", counts }); }).catch(() => { if (current) setTeam({ kind: "error" }); });
    return () => { current = false; };
  }, [isAuthenticated, loadTeam, attempt, loaded, hidden]);

  if (failed) return <GuideUnavailable onRetry={onRetry} />;
  if (status === undefined) return <GettingStartedSkeleton />;

  async function change(kind: "hide" | "show" | "dry-run" | "team", run: () => Promise<unknown>) {
    setPending(kind); setError("");
    try { await run(); }
    catch { setError(kind === "dry-run" || kind === "team" ? "Could not save that step. Try again." : "Could not save your guide setting. Try again."); }
    finally { setPending(null); }
  }

  if (hidden) return <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
    <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("show", () => setHidden({ hidden: false }))}>{pending === "show" ? "Showing…" : "Show getting started guide"}</Button>
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </div>;

  const firstEvent = events.at(-1);
  const invitedDone = team.kind === "ready" && (team.counts.invited > 0 || team.counts.members > 1);
  const teamDone = invitedDone || status.teamSkipped;
  const dryRunDone = status.testPeopleAdded || status.dryRunMarked;
  const steps = [events.length > 0, teamDone, status.connected, styleCount > 0, dryRunDone];
  const progress = guideProgress(steps);

  // The first step still to do gets the dark button; the rest are outlined.
  const next = steps.findIndex((done) => !done);
  const variant = (index: number) => index === next ? "default" as const : "outline" as const;
  const linkButton = (index: number, href: string, label: string) => <Link data-slot="button" className={cn(buttonVariants({ size: "sm", variant: variant(index) }), index === next ? "!text-primary-foreground" : "!text-foreground")} href={href}>{label}</Link>;

  return <div className="flex flex-col gap-2.5">
    <section className="ws-card" aria-labelledby="getting-started-heading">
      <div className="ws-card-head h-12 flex-wrap gap-x-2.5 gap-y-1 px-4">
        <h2 id="getting-started-heading" className="m-0 text-[13px] font-semibold">Getting started<span className="sr-only"> with {organizationName}</span></h2>
        <span className="ws-count text-xs">{progress.done} of {progress.total}</span>
        <div className="h-1.5 max-w-[200px] flex-1 overflow-hidden rounded-full bg-[var(--dq-segment)]" role="progressbar" aria-label="Guide progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="h-full rounded-full bg-[var(--dq-accent)] transition-[width]" style={{ width: `${progress.percent}%` }} />
        </div>
        <span className="flex-1" />
        {alwaysOpen && status.hidden
          ? <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" disabled={pending !== null} onClick={() => void change("show", () => setHidden({ hidden: false }))}>{pending === "show" ? "Showing…" : "Show on Events"}</Button>
          : <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" disabled={pending !== null} onClick={() => void change("hide", () => setHidden({ hidden: true }))}>{pending === "hide" ? "Hiding…" : alwaysOpen ? "Hide on Events" : "Hide guide"}</Button>}
      </div>
      {error && <div className="px-4 pb-2.5"><p role="alert" className="ws-error">{error}</p></div>}
      <StepCompletions steps={steps} settled={team.kind !== "loading"} />
      <ol className="ws-list">
        <StepRow title="Create your first event" done={steps[0]} detail={firstEvent ? firstEvent.name : "Name it, pick demo night or hackathon, and share the submit link."}
          action={!steps[0] && <Button size="sm" variant={variant(0)} onClick={onCreateEvent}>Create event</Button>} />
        <StepRow title="Invite your team" done={teamDone} detail={invitedDone && team.kind === "ready" ? teamSummary(team.counts)
          : status.teamSkipped ? "Skipped. Invite people any time from Members."
          : team.kind === "loading" ? <Skeleton className="h-3 w-52" />
          : team.kind === "error" ? <span role="alert" className="text-destructive">Could not check your invitations.</span>
          : "Optional. Everyone you invite can run every event with you."}
          action={invitedDone ? null
            : status.teamSkipped ? <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("team", () => skipTeam({ skipped: false }))}>Undo</Button>
            : team.kind === "error" ? <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
            : team.kind === "ready" && <>
              <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("team", () => skipTeam({ skipped: true }))}>{pending === "team" ? "Saving…" : "Skip"}</Button>
              {linkButton(1, "/members", "Invite people")}
            </>} />
        <StepRow title="Connect your AI assistant" done={status.connected}
          detail={status.connected ? "Connected. Ask it to create an event, add judges or check judging progress." : "Ask it to create an event, add judges or check judging progress."}
          action={!status.connected && linkButton(2, "/events/connections", "Full setup and connections")} />
        <StepRow title="Add your look" done={steps[3]} detail={steps[3] ? `${styleCount} ${styleCount === 1 ? "style" : "styles"} ready.` : "Optional. Pick the style for the stage and submit pages."}
          action={!steps[3] && <Button variant={variant(3)} size="sm" onClick={onOpenStyles}>Open styles</Button>} />
        <StepRow title="Do a dry run" done={dryRunDone} detail={dryRunDone ? (status.testPeopleAdded ? "Test people added. Clear them before the real event." : "Marked done.") : "Add test people to an event, open the presentation view and run the queue once. Test people are easy to clear."}
          action={!dryRunDone ? <>
            <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("dry-run", () => markDryRun({ done: true }))}>{pending === "dry-run" ? "Saving…" : "Mark done"}</Button>
            {linkButton(4, "/events/practice", "Start a practice event")}
          </> : status.dryRunMarked && !status.testPeopleAdded && <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("dry-run", () => markDryRun({ done: false }))}>Undo</Button>} />
      </ol>
    </section>
    <p className="ws-help">{progress.done === progress.total ? `${organizationName} is ready for its first event.` : "Your own progress; the organization's one-off steps show as done for everyone. Each step ticks itself when you do it."}</p>
  </div>;
}
