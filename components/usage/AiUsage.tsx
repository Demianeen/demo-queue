"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConvex, useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorText } from "@/components/live/changes";
import { PRICES_CHECKED } from "@/lib/ai-prices";
import { adminPath } from "@/lib/routes";
import {
  formatCount, formatTokensShort, formatUsageTime, formatUsd, parseUsageMonth, recentUsageMonths, usageCsv, usageMonthKey,
  usageMonthLabel, usageMonthOf, usageResultLabel, type UsageCsvRow, type UsageMonth,
} from "@/lib/ai-usage";
import styles from "./ai-usage.module.css";

type Summary = FunctionReturnType<typeof api.aiUsage.monthSummary>;
type Call = FunctionReturnType<typeof api.aiUsage.monthCalls>["page"][number];

const FIRST_CALLS = 10;

/** The month in the address (?month=2026-10), or this UTC month. An invalid value is passed on, so the page says so. */
function useUsageMonth() {
  const search = useSearchParams();
  const raw = search.get("month");
  const current = usageMonthKey(usageMonthOf(Date.now()));
  return { key: raw ?? current, month: parseUsageMonth(raw ?? current) };
}

const monthName = (month: UsageMonth | null) => (month ? usageMonthLabel(month).split(" ")[0] : "this month");

/** Month picker and Download CSV, in the page header. */
export function AiUsageHeaderActions() {
  const { key, month } = useUsageMonth();
  const router = useRouter();
  const pathname = usePathname();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [downloading, setDownloading] = useState(false);
  const months = useMemo(() => recentUsageMonths(Date.now()), []);

  async function download() {
    setDownloading(true);
    try {
      const rows: UsageCsvRow[] = [];
      let cursor: string | null = null;
      for (;;) {
        const result: FunctionReturnType<typeof api.aiUsage.monthCalls> = await convex.query(api.aiUsage.monthCalls, { month: key, paginationOpts: { numItems: 500, cursor } });
        rows.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      const url = URL.createObjectURL(new Blob([usageCsv(rows)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai-usage-${key}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      toast.error(errorText(failure, "Could not download the CSV. Try again."));
    } finally {
      setDownloading(false);
    }
  }

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label={`Month: ${month ? usageMonthLabel(month) : key}`} />}>
        {month ? usageMonthLabel(month) : "Choose a month"}<ChevronDown aria-hidden className="text-[var(--dq-fg-3)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Month (UTC)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={key} onValueChange={(value) => router.replace(`${pathname}?month=${value}`, { scroll: false })}>
            {months.map((option) => <DropdownMenuRadioItem key={usageMonthKey(option)} value={usageMonthKey(option)}>{usageMonthLabel(option)}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="outline" size="sm" disabled={!month || !isAuthenticated || downloading} onClick={() => void download()}>{downloading ? "Preparing…" : "Download CSV"}</Button>
  </>;
}

/** AI usage: what the AI summaries and AI shuffle cost the organization, estimated from logged tokens. */
export function AiUsage() {
  const { key, month } = useUsageMonth();
  return <div className={styles.root}>
    <title>AI usage | Demo Queue</title>
    <div className={styles.heading}>
      <h1>AI usage</h1>
      <p>What the AI summaries and AI shuffle cost this organisation, estimated from the tokens each call used and OpenAI&apos;s list prices. OpenAI&apos;s bill is the final word.</p>
    </div>
    <UsageErrorBoundary key={key}><UsageContent monthKey={key} month={month} /></UsageErrorBoundary>
  </div>;
}

class UsageErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <Alert variant="destructive" className="flex flex-col gap-2.5">
      <AlertTitle>Could not load AI usage</AlertTitle>
      <AlertDescription>{errorText(this.state.error, "The usage for this month did not load. Nothing was changed.")}</AlertDescription>
      <div><Button size="sm" onClick={() => this.setState({ error: null })}>Try again</Button></div>
    </Alert>;
  }
}

function UsageContent({ monthKey, month }: { monthKey: string; month: UsageMonth | null }) {
  const { isAuthenticated } = useConvexAuth();
  const summary = useQuery(api.aiUsage.monthSummary, isAuthenticated ? { month: monthKey } : "skip");
  if (summary === undefined) return <UsageSkeleton />;
  const name = monthName(month);
  return <>
    {summary.truncated && <Alert className="mb-4"><AlertDescription>This month has more calls than the page adds up. Totals cover the first {formatCount(summary.totals.calls)}; the CSV has every call.</AlertDescription></Alert>}
    <div className={styles.layout}>
      <div className={styles.main}>
        <Kpis summary={summary} monthName={name} />
        <SpendByDay summary={summary} month={month} />
        <ByEvent summary={summary} monthName={name} />
      </div>
      <CostCard summary={summary} />
    </div>
    <Calls monthKey={monthKey} total={summary.totals.calls} monthName={name} />
  </>;
}

function Kpis({ summary, monthName }: { summary: Summary; monthName: string }) {
  const { totals } = summary;
  const unpriced = totals.unpricedCalls;
  return <div className={styles.kpis}>
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>Spent in {monthName}</div>
      <div className={styles.kpiValue}>{formatUsd(totals.usd)}</div>
      <div className={styles.kpiNote} data-tone={unpriced ? "warning" : undefined}>{unpriced ? `estimate; ${unpriced} call${unpriced === 1 ? "" : "s"} without a price left out` : "estimate, from logged tokens"}</div>
    </div>
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>Model calls</div>
      <div className={styles.kpiValue}>{formatCount(totals.calls)}</div>
      <div className={styles.kpiNote}>{formatCount(totals.summaries)} summar{totals.summaries === 1 ? "y" : "ies"} · {formatCount(totals.shuffles)} shuffle{totals.shuffles === 1 ? "" : "s"}</div>
    </div>
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>Tokens</div>
      <div className={styles.kpiValue}>{formatTokensShort(totals.inputTokens + totals.outputTokens)}</div>
      <div className={styles.kpiNote}>{totals.pricedSummaries > 0 ? `about ${formatUsd(totals.summaryUsd / totals.pricedSummaries, true)} per summary call` : "input and output"}</div>
    </div>
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>Practice samples</div>
      <div className={styles.kpiValue}>{formatCount(summary.practiceSamples)}</div>
      <div className={styles.kpiNote}>summaries written without the model</div>
    </div>
  </div>;
}

function SpendByDay({ summary, month }: { summary: Summary; month: UsageMonth | null }) {
  const totals = summary.days.map((day) => day.summaryUsd + day.shuffleUsd);
  const max = Math.max(0, ...totals);
  const peakIndex = max > 0 ? totals.indexOf(max) : -1;
  const now = new Date();
  const thisMonth = month && month.year === now.getUTCFullYear() && month.month === now.getUTCMonth() + 1;
  const short = month ? usageMonthLabel(month).slice(0, 3) : "";
  const labelled = new Set([1, 5, 10, 15, 20, 25, 30]);
  return <section className={`${styles.card} ${styles.chartCard}`} aria-labelledby="usage-by-day">
    <div className={styles.chartHead}>
      <h2 id="usage-by-day">Spend by day</h2>
      <span className={styles.legend}><i data-series="summary" aria-hidden />Summaries</span>
      <span className={styles.legend}><i data-series="shuffle" aria-hidden />Shuffle</span>
      <span className="flex-1" />
      <span className={styles.peak}>{peakIndex >= 0 ? `peak ${formatUsd(max)} on ${peakIndex + 1} ${short}` : "no spend yet"}</span>
    </div>
    <div className={styles.bars} role="list" aria-label="Estimated spend per day, UTC">
      {summary.days.map((day, index) => {
        const total = totals[index];
        const future = thisMonth && day.day > now.getUTCDate();
        const height = (value: number) => (max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 120)) : 0);
        const label = `${day.day} ${short}: ${formatUsd(total, true)}${day.calls ? `, ${day.calls} call${day.calls === 1 ? "" : "s"}` : ""}`;
        return <div key={day.day} role="listitem" aria-label={label} title={label} className={styles.bar} data-future={future ? "" : undefined}>
          {total > 0 ? <>
            {day.shuffleUsd > 0 && <div data-series="shuffle" style={{ height: height(day.shuffleUsd) }} />}
            {day.summaryUsd > 0 && <div data-series="summary" style={{ height: height(day.summaryUsd) }} />}
          </> : <div data-series="none" />}
          <span className={styles.tick} data-hidden={labelled.has(day.day) ? undefined : ""}>{day.day}</span>
        </div>;
      })}
    </div>
  </section>;
}

const KIND_LABELS = { real: "Real", practice_model: "Practice · real model", practice_sample: "Practice · sample summaries" } as const;

function ByEvent({ summary, monthName }: { summary: Summary; monthName: string }) {
  return <section className={styles.card} aria-labelledby="usage-by-event">
    <div className={styles.cardHead}><h2 id="usage-by-event">By event</h2><span className={styles.cardHint}>Real and practice events, newest activity first</span></div>
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead><tr><th>Event</th><th className={styles.num}>Summaries</th><th className={styles.num}>Shuffles</th><th className={styles.num}>Tokens</th><th className={styles.num}>Cost</th><th className={styles.num}>Per project</th><th className={styles.num}>Summary runs today</th></tr></thead>
        <tbody>
          {summary.events.length === 0 ? <tr><td colSpan={7} className={styles.empty}>No AI summaries or shuffles in {monthName}.</td></tr>
            : summary.events.map((event) => <tr key={event.id}>
              <td>
                {event.slug ? <Link href={adminPath(event.slug)} className={styles.name}>{event.name}</Link> : <span className={styles.name}>{event.name}</span>}
                <div className={styles.sub}>{KIND_LABELS[event.kind]}{event.samples > 0 ? ` · ${event.samples} sample${event.samples === 1 ? "" : "s"}` : ""}</div>
              </td>
              <td className={styles.num}>{formatCount(event.summaries)}</td>
              <td className={styles.num}>{formatCount(event.shuffles)}</td>
              <td className={`${styles.num} ${styles.mono}`}>{formatTokensShort(event.tokens)}</td>
              <td className={`${styles.num} ${styles.mono}`}>{formatUsd(event.usd)}{event.unpricedCalls > 0 && <div className={styles.sub} data-tone="warning">+{event.unpricedCalls} unpriced</div>}</td>
              <td className={`${styles.num} ${styles.mono} ${styles.muted}`}>{event.perProjectUsd === null ? "none" : formatUsd(event.perProjectUsd, true)}</td>
              <td className={`${styles.num} ${event.summaryRuns.kind === "used" ? "" : styles.faint}`}>{event.summaryRuns.kind === "used" ? `${event.summaryRuns.used} of ${event.summaryRuns.cap}` : event.summaryRuns.kind === "samples_only" ? "samples only" : "none"}</td>
            </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

function CostCard({ summary }: { summary: Summary }) {
  return <aside className={`${styles.card} ${styles.costCard}`} aria-labelledby="usage-cost">
    <h2 id="usage-cost">How the cost is worked out</h2>
    {summary.prices.map((entry) => <dl key={entry.model} className={styles.props}>
      <dt>Model</dt><dd className={styles.mono}>{entry.model}</dd>
      {entry.price ? <>
        <dt>Input, per 1M</dt><dd className={styles.mono}>{formatUsd(entry.price.input)}</dd>
        <dt>Cached input, per 1M</dt><dd className={styles.mono}>{formatUsd(entry.price.cachedInput, entry.price.cachedInput < 0.1)}</dd>
        <dt>Output, per 1M</dt><dd className={styles.mono}>{formatUsd(entry.price.output)}</dd>
      </> : <><dt>Price</dt><dd data-tone="warning">price unknown, its calls are left out of the total</dd></>}
    </dl>)}
    <p className={styles.note}>OpenAI&apos;s Standard list prices, kept in the app and checked {PRICES_CHECKED}. Output includes the model&apos;s reasoning tokens. Retries and rejected replies count: OpenAI charges for them too.</p>
    <dl className={`${styles.props} ${styles.divided}`}>
      <dt>Summary runs per event</dt><dd>{summary.budget.perProject} per project a day, at least {summary.budget.floor}</dd>
      <dt>New practice events</dt><dd>Sample summaries, unless real AI is on</dd>
    </dl>
    <p className={styles.note}>When an event has used today&apos;s summary runs, no more are queued until the next day (UTC).</p>
  </aside>;
}

function Calls({ monthKey, total, monthName }: { monthKey: string; total: number; monthName: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [all, setAll] = useState(false);
  const calls = usePaginatedQuery(api.aiUsage.monthCalls, isAuthenticated ? { month: monthKey } : "skip", { initialNumItems: FIRST_CALLS });
  // "Show all" keeps loading pages until the month is done.
  const { status, loadMore } = calls;
  useEffect(() => { if (all && status === "CanLoadMore") loadMore(100); }, [all, status, loadMore]);
  const loading = calls.status === "LoadingFirstPage";
  const rows = all ? calls.results : calls.results.slice(0, FIRST_CALLS);
  return <section className={`${styles.card} ${styles.calls}`} aria-labelledby="usage-calls">
    <div className={styles.cardHead}><h2 id="usage-calls">Model calls</h2><span className={styles.cardHint}>One row per call to OpenAI, newest first, times in UTC</span></div>
    <div className={styles.scroll}>
      <table className={`${styles.table} ${styles.callsTable}`}>
        <thead><tr><th>When</th><th>Project</th><th>Feature</th><th className={styles.num}>Input</th><th className={styles.num}>Of which cached</th><th className={styles.num}>Output</th><th className={styles.num}>Cost</th><th>Result</th></tr></thead>
        <tbody>
          {loading ? [0, 1, 2, 3].map((index) => <tr key={index} aria-hidden>{[64, 140, 56, 40, 40, 40, 40, 90].map((width, cell) => <td key={cell} className={cell >= 3 && cell <= 6 ? styles.num : undefined}><Skeleton className="h-3" style={{ width, marginLeft: cell >= 3 && cell <= 6 ? "auto" : undefined }} /></td>)}</tr>)
            : rows.length === 0 ? <tr><td colSpan={8} className={styles.empty}>No model calls in {monthName}. A row appears for every summary the model writes and every AI shuffle.</td></tr>
            : rows.map((call) => <CallRow key={call.id} call={call} />)}
        </tbody>
      </table>
    </div>
    <div className={styles.callsFoot}>
      <span>Retries and failed calls count: OpenAI charges for them too.</span>
      {!all && total > FIRST_CALLS && <Button variant="ghost" size="sm" onClick={() => setAll(true)}>Show all {formatCount(total)}</Button>}
      {all && calls.status === "LoadingMore" && <span role="status">Loading more calls…</span>}
    </div>
  </section>;
}

function tokens(value: number | null) {
  return value === null ? <span className={styles.faint}>n/a</span> : formatCount(value);
}

function CallRow({ call }: { call: Call }) {
  const result = usageResultLabel(call.feature, call.result);
  return <tr>
    <td className={`${styles.mono} ${styles.faint} ${styles.nowrap}`}>{formatUsageTime(call.createdAt)}</td>
    <td><span className={styles.name}>{call.feature === "shuffle" ? "Lineup shuffle" : call.project ?? "Removed project"}</span><div className={styles.sub}>{call.eventName}</div></td>
    <td className={`${styles.muted} ${styles.nowrap}`}>{call.feature === "shuffle" ? "Shuffle" : "Summary"}</td>
    <td className={`${styles.num} ${styles.mono}`}>{tokens(call.inputTokens)}</td>
    <td className={`${styles.num} ${styles.mono} ${styles.faint}`}>{tokens(call.cachedInputTokens)}</td>
    <td className={`${styles.num} ${styles.mono}`}>{tokens(call.outputTokens)}</td>
    <td className={`${styles.num} ${styles.mono} ${styles.nowrap}`} title={call.model}>
      {call.cost.kind === "priced" ? formatUsd(call.cost.usd, true) : call.cost.kind === "no_usage" ? <span className={styles.faint}>no usage</span> : <span data-tone="warning">price unknown</span>}
    </td>
    <td className={styles.nowrap} data-tone={result.tone}>{result.label}</td>
  </tr>;
}

function UsageSkeleton() {
  return <div aria-busy="true" aria-label="Loading AI usage">
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.kpis}>{[0, 1, 2, 3].map((index) => <div key={index} className={styles.kpi}><Skeleton className="h-3 w-24" /><Skeleton className="mt-2 h-6 w-16" /><Skeleton className="mt-4 h-3 w-32 max-w-full" /></div>)}</div>
        <div className={`${styles.card} ${styles.chartCard}`}><Skeleton className="h-3.5 w-28" /><Skeleton className="mt-4 h-[140px] w-full" /></div>
        <div className={`${styles.card} ${styles.cardPad}`}><Skeleton className="h-3.5 w-20" />{[0, 1, 2].map((index) => <Skeleton key={index} className="mt-4 h-3 w-full" />)}</div>
      </div>
      <div className={`${styles.card} ${styles.costCard}`}><Skeleton className="h-3.5 w-44" />{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-3 w-full" />)}</div>
    </div>
    <div className={`${styles.card} ${styles.calls} ${styles.cardPad}`}><Skeleton className="h-3.5 w-24" />{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="mt-4 h-3 w-full" />)}</div>
  </div>;
}
