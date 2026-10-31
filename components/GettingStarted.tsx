"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectAssistant } from "@/components/ConnectAssistant";
import { guideProgress, teamSummary, type TeamCounts } from "@/lib/getting-started";
import { cn } from "@/lib/utils";

type EventSummary = { name: string; slug: string };
type Team = { kind: "loading" } | { kind: "ready"; counts: TeamCounts } | { kind: "error" };

const card = "rounded-lg border border-border bg-card text-card-foreground";

function StepRow({ number, title, done, detail, children, open }: { number: number; title: string; done: boolean; detail?: ReactNode; children?: ReactNode; open?: boolean }) {
  return <li className={cn("flex gap-3 border-t border-border px-6 py-4 max-sm:px-4", open && "bg-muted/40")}>
    <span className={cn("grid size-7 flex-none place-items-center rounded-full text-xs font-semibold", done ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground")} aria-hidden>{done ? <Check className="size-3.5" /> : number}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <p className="m-0 text-[15px] font-semibold">{title}<span className="sr-only">{done ? ", done" : ", not done"}</span></p>
      {detail && <div className="text-sm text-muted-foreground">{detail}</div>}
      {children}
    </div>
  </li>;
}

/** Skeleton shaped like the guide: header, progress bar and five rows. */
export function GettingStartedSkeleton() {
  return <section className={card} aria-busy="true" aria-label="Loading getting started guide">
    <div className="flex flex-col gap-3 px-6 py-5 max-sm:px-4"><Skeleton className="h-5 w-72 max-w-full" /><Skeleton className="h-3.5 w-56 max-w-full" /><Skeleton className="h-1.5 w-full rounded-full" /></div>
    {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-3 border-t border-border px-6 py-4 max-sm:px-4"><Skeleton className="size-7 rounded-full" /><Skeleton className="h-4 w-56 max-w-full" /></div>)}
  </section>;
}

type GuideProps = { organizationName: string; events: EventSummary[]; styleCount: number; onCreateEvent: () => void; onOpenStyles: () => void };

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

function Guide({ organizationName, events, styleCount, onCreateEvent, onOpenStyles, onRetry }: GuideProps & { onRetry: () => void }) {
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
  const loadTeam = useAction(api.gettingStarted.teamStatus);
  const [team, setTeam] = useState<Team>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"hide" | "show" | "dry-run" | null>(null);

  const loaded = status !== undefined;
  const hidden = status?.hidden ?? false;
  useEffect(() => {
    if (!isAuthenticated || !loaded || hidden) return;
    let current = true;
    setTeam({ kind: "loading" });
    loadTeam({}).then((counts) => { if (current) setTeam({ kind: "ready", counts }); }).catch(() => { if (current) setTeam({ kind: "error" }); });
    return () => { current = false; };
  }, [isAuthenticated, loadTeam, attempt, loaded, hidden]);

  if (failed) return <GuideUnavailable onRetry={onRetry} />;
  if (status === undefined) return <GettingStartedSkeleton />;

  async function change(kind: "hide" | "show" | "dry-run", run: () => Promise<unknown>) {
    setPending(kind); setError("");
    try { await run(); }
    catch { setError(kind === "dry-run" ? "Could not save that step. Try again." : "Could not save your guide setting. Try again."); }
    finally { setPending(null); }
  }

  if (status.hidden) return <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
    <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("show", () => setHidden({ hidden: false }))}>{pending === "show" ? "Showing…" : "Show getting started guide"}</Button>
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </div>;

  const firstEvent = events.at(-1);
  const teamDone = team.kind === "ready" && (team.counts.invited > 0 || team.counts.members > 1);
  const dryRunDone = status.testPeopleAdded || status.dryRunMarked;
  const steps = [events.length > 0, teamDone, status.connected, styleCount > 0, dryRunDone];
  const progress = guideProgress(steps);

  return <section className={card} aria-labelledby="getting-started-heading">
    <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-4 max-sm:px-4">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        <h2 id="getting-started-heading" className="m-0 text-lg font-semibold">{progress.done === progress.total ? `${organizationName} is ready` : `Get ${organizationName} ready for its first event`}</h2>
        <p className="m-0 text-sm text-muted-foreground">{progress.done} of {progress.total} done. Steps tick themselves off as you do them.</p>
      </div>
      <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("hide", () => setHidden({ hidden: true }))}>{pending === "hide" ? "Hiding…" : "Hide guide"}</Button>
      <div className="h-1.5 w-full basis-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Guide progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.percent}%` }} />
      </div>
      {error && <Alert variant="destructive" className="basis-full"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
    <ol className="m-0 list-none p-0">
      <StepRow number={1} title="Create your first event" done={steps[0]} detail={firstEvent ? firstEvent.name : "Name it, pick demo night or hackathon, and share the submit link."}>
        {!steps[0] && <div><Button size="sm" onClick={onCreateEvent}>Create event</Button></div>}
      </StepRow>
      <StepRow number={2} title="Invite your team" done={teamDone} detail={team.kind === "loading" ? <Skeleton className="h-4 w-52" /> : team.kind === "error"
        ? <span className="flex flex-wrap items-center gap-2"><span role="alert" className="text-destructive">Could not check your invitations.</span><Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button></span>
        : teamDone ? teamSummary(team.counts) : "Everyone you invite can run every event with you."}>
        {team.kind === "ready" && !teamDone && <div><Link data-slot="button" className={cn(buttonVariants({ size: "sm" }), "!text-primary-foreground")} href="/members">Invite people</Link></div>}
      </StepRow>
      <StepRow number={3} title="Connect your AI assistant" done={status.connected} open={!status.connected}
        detail={status.connected ? "Connected. Ask it to create an event, add judges or check judging progress." : "Run events by asking: create an event, add judges, check judging progress. Works with any assistant that supports MCP."}>
        {!status.connected && <ConnectAssistant mcpUrl={status.mcpUrl} connected={status.connected} />}
        <div><Link className="text-sm underline underline-offset-4" href="/events/connections">Full setup and connections</Link></div>
      </StepRow>
      <StepRow number={4} title="Add your look" done={steps[3]} detail={steps[3] ? `${styleCount} ${styleCount === 1 ? "style" : "styles"} ready.` : "Optional. Upload a logo and colours for the stage and submit pages."}>
        {!steps[3] && <div><Button variant="outline" size="sm" onClick={onOpenStyles}>Open styles</Button></div>}
      </StepRow>
      <StepRow number={5} title="Do a dry run" done={dryRunDone} detail={dryRunDone ? (status.testPeopleAdded ? "Test people added. Clear them before the real event." : "Marked done.") : "Add test people to an event, open the presentation view and run the queue once. Test people are easy to clear."}>
        {!dryRunDone && <div className="flex flex-wrap gap-2">
          {firstEvent && <Link data-slot="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "!text-foreground")} href={`/events/${firstEvent.slug}/admin`}>Open your event</Link>}
          <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("dry-run", () => markDryRun({ done: true }))}>{pending === "dry-run" ? "Saving…" : "Mark done"}</Button>
        </div>}
        {status.dryRunMarked && !status.testPeopleAdded && <div><Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change("dry-run", () => markDryRun({ done: false }))}>Undo</Button></div>}
      </StepRow>
    </ol>
  </section>;
}
