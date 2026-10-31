"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, Copy, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { judgingPath } from "@/lib/admin-views";
import { judgeInitials } from "@/lib/judging-board";
import { absoluteUrl } from "@/lib/routes";
import { randomToken } from "@/lib/tokens";
import { errorText } from "./changes";
import { timeAgo, useTick } from "./clock";
import styles from "./judge-tools.module.css";

export type JudgesOverview = FunctionReturnType<typeof api.judging.getJudgesOverview>;
export type JudgeRow = JudgesOverview["judges"][number];
type Format = "text" | "notion";
type RedistributionPlan = FunctionReturnType<typeof api.judging.previewRedistribution>;

/** A link without the scheme, the way people read it: hack.outpostcrew.co/judge/… */
function shortLink(path: string) {
  return absoluteUrl(path).replace(/^https?:\/\//, "");
}

/** The WhatsApp or Slack message, and the Notion table, for every active judge's link. */
export function judgeLinksText(eventName: string, judges: Pick<JudgeRow, "judgeName" | "path" | "active">[], format: Format) {
  const rows = judges.filter((judge) => judge.active && judge.path);
  if (format === "notion") {
    return `| Judge | Link |\n| --- | --- |\n${rows.map((judge) => `| ${judge.judgeName.replace(/\|/g, "/")} | ${absoluteUrl(judge.path!)} |`).join("\n")}`;
  }
  return `${eventName}: judging links\nOpen yours on your laptop. Don't share it.\n\n${rows.map((judge) => `${judge.judgeName}: ${absoluteUrl(judge.path!)}`).join("\n")}`;
}

function notionHtml(judges: Pick<JudgeRow, "judgeName" | "path" | "active">[]) {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rows = judges.filter((judge) => judge.active && judge.path);
  return `<table><thead><tr><th>Judge</th><th>Link</th></tr></thead><tbody>${rows.map((judge) => `<tr><td>${escape(judge.judgeName)}</td><td><a href="${escape(absoluteUrl(judge.path!))}">${escape(absoluteUrl(judge.path!))}</a></td></tr>`).join("")}</tbody></table>`;
}

async function copyText(text: string, html?: string) {
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

async function copyJudgeLink(judge: JudgeRow) {
  if (!judge.path) return;
  try { await navigator.clipboard.writeText(absoluteUrl(judge.path)); toast(`Copied ${judge.judgeName}'s link`); } catch { toast.error("Could not copy the link."); }
}

/** How far a judge is through their own list: "3 of 8", with a small pie. */
function Scored({ judge }: { judge: JudgeRow }) {
  const share = judge.assignedCount === 0 ? 0 : judge.assignedScoredCount / judge.assignedCount;
  return <span className={styles.scored}>
    <span className={styles.pie} style={{ ["--share" as string]: `${Math.round(share * 360)}deg` }} data-empty={share === 0 ? "" : undefined} aria-hidden />
    <span className="dq-mono">{judge.assignedScoredCount} of {judge.assignedCount}</span>
    {judge.helpedCount > 0 && <span className={styles.muted}>+{judge.helpedCount}</span>}
  </span>;
}

function Opened({ judge, now }: { judge: JudgeRow; now: number }) {
  if (!judge.hasLink) return <span className={styles.muted}>No link yet</span>;
  if (!judge.active) return <span className={styles.muted}>Off</span>;
  if (judge.openedAt) return <span className={styles.muted}>opened {timeAgo(judge.openedAt, now)}</span>;
  // A saved score means the link was opened, even when the open was never recorded.
  return judge.assignedScoredCount + judge.helpedCount > 0 ? <span className={styles.muted}>opened</span> : <span className={styles.notOpened}>Not opened</span>;
}

/**
 * The Overview's judges list during judging, least scored first, so the
 * judge to chase is on top. The menu copies a link or opens the judge on
 * Judging, where the fixes are.
 */
export function JudgesList({ slug, overview }: { slug: string; overview: JudgesOverview | undefined }) {
  const now = useTick(true);
  const judges = useMemo(() => [...(overview?.judges ?? [])].filter((judge) => judge.onRoster || judge.active)
    .sort((left, right) => left.assignedScoredCount + left.helpedCount - (right.assignedScoredCount + right.helpedCount) || left.judgeName.localeCompare(right.judgeName)), [overview]);
  const judgeLabels = useMemo(() => judgeInitials((overview?.judges ?? []).map((judge) => judge.judgeName)), [overview]);
  return <section className={`dq-card ${styles.listCard}`} aria-labelledby="judges-list-title">
    <div className={styles.listHead}><h2 id="judges-list-title">Judges <span className={styles.count}>{overview ? judges.length : ""}</span></h2><span className={styles.muted}>least scored first</span></div>
    {overview === undefined ? [0, 1, 2].map((key) => <div key={key} className={styles.judgeRow} aria-hidden><Skeleton className="size-6 rounded-full" /><Skeleton className="h-3 w-32" /><Skeleton className="ml-auto h-3 w-24" /></div>)
      : judges.length === 0 ? <p className={styles.empty}>No judges yet. Add them on <Link href={judgingPath(slug)}>Judging</Link>.</p>
      : judges.map((judge) => <div key={judge.judgeKey} className={styles.judgeRow} data-off={judge.hasLink && !judge.active ? "" : undefined}>
        <span className={styles.avatar} aria-hidden>{judgeLabels.get(judge.judgeName) ?? "?"}</span>
        <span className={styles.judgeName}>{judge.judgeName}</span>
        <span className={styles.rowEnd}><Opened judge={judge} now={now} /><Scored judge={judge} />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`More for ${judge.judgeName}`} />}><MoreHorizontal aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!judge.path || !judge.active} onClick={() => void copyJudgeLink(judge)}>Copy link</DropdownMenuItem>
              <DropdownMenuItem render={<Link href={judgingPath(slug, { judge: judge.judgeKey })} />}>Replace, move scores or turn off…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>)}
  </section>;
}

/**
 * The Judging page's judges card: who opened their link and how far they
 * are; a row opens its link and the fixes for when something goes wrong on
 * the night. The open judge is in the address (`&judge=`).
 */
export function JudgesCard({ slug, eventName, overview, openKey, onOpen, onManage, titleById }: {
  slug: string;
  eventName: string;
  overview: JudgesOverview | undefined;
  openKey: string | null;
  onOpen: (judgeKey: string | null) => void;
  onManage: () => void;
  /** Project titles, for the turn-off plan. */
  titleById: ReadonlyMap<string, string>;
}) {
  const now = useTick(true);
  const judges = useMemo(() => overview?.judges ?? [], [overview]);
  const judgeLabels = useMemo(() => judgeInitials(judges.map((judge) => judge.judgeName)), [judges]);
  const [moving, setMoving] = useState(false);
  const open = judges.find((judge) => judge.judgeKey === openKey) ?? null;
  const index = open ? judges.indexOf(open) : -1;
  const commands = useMemo<Command[]>(() => [
    { id: "judges-next", group: "This page", label: "Next judge", keys: ["J"], disabled: judges.length === 0, run: () => onOpen(judges[Math.min(index + 1, judges.length - 1)]?.judgeKey ?? null) },
    { id: "judges-previous", group: "This page", label: "Previous judge", keys: ["K"], disabled: judges.length === 0, run: () => onOpen(judges[Math.max(index - 1, 0)]?.judgeKey ?? null) },
    { id: "judges-move", group: "This page", label: "Move scores to another judge", keys: ["M"], disabled: !open || judges.length < 2, run: () => setMoving(true) },
    { id: "judges-add", group: "This page", label: "Add or remove judges", run: onManage },
  ], [judges, index, open, onOpen, onManage]);
  useCommands("judges-card", commands);

  return <section className={`dq-card ${styles.listCard}`} aria-labelledby="judges-card-title">
    <div className={styles.listHead}>
      <h2 id="judges-card-title">Judges <span className={styles.count}>{overview ? judges.filter((judge) => judge.onRoster).length : ""}</span></h2>
      <span className={styles.headActions}><CopyAllLinks eventName={eventName} judges={judges} disabled={!overview} /><Button variant="outline" size="sm" onClick={onManage}>Manage</Button></span>
    </div>
    {overview === undefined ? [0, 1, 2, 3].map((key) => <div key={key} className={styles.judgeRow} aria-hidden><Skeleton className="size-6 rounded-full" /><Skeleton className="h-3 w-28" /><Skeleton className="ml-auto h-3 w-20" /></div>)
      : judges.length === 0 ? <div className={styles.empty}>No judges yet. Add their names, and each gets a private link to score from their laptop.<div className="mt-3"><Button size="sm" variant="outline" onClick={onManage}>Add judges</Button></div></div>
      : judges.map((judge) => <div key={judge.judgeKey}>
        <button type="button" className={styles.judgeRow} data-button="" data-open={judge.judgeKey === openKey ? "" : undefined} data-off={judge.hasLink && !judge.active ? "" : undefined}
          aria-expanded={judge.judgeKey === openKey} onClick={() => onOpen(judge.judgeKey === openKey ? null : judge.judgeKey)}>
          <span className={styles.avatar} aria-hidden>{judgeLabels.get(judge.judgeName) ?? "?"}</span>
          <span className={styles.judgeName}>{judge.judgeName}{!judge.onRoster && <span className={styles.badge}>Not on the roster</span>}</span>
          <span className={styles.rowEnd}><Opened judge={judge} now={now} /><Scored judge={judge} /><MoreHorizontal aria-hidden className={styles.more} /></span>
        </button>
        {judge.judgeKey === openKey && <JudgeFixes slug={slug} judge={judge} judges={judges} judgingStatus={overview.judgingStatus} titleById={titleById} moving={moving} setMoving={setMoving} />}
      </div>)}
    <p className={styles.note}>Each judge has one private link. &quot;Not opened&quot; ten minutes before judging is the one to chase.</p>
  </section>;
}

export function CopyAllLinks({ eventName, judges, disabled }: { eventName: string; judges: JudgeRow[]; disabled: boolean }) {
  const [format, setFormat] = useState<Format>("text");
  const [open, setOpen] = useState(false);
  const rows = judges.filter((judge) => judge.active && judge.path);
  const text = judgeLinksText(eventName, judges, format);
  const previewLines = format === "text" ? text.split("\n").slice(0, 6) : text.split("\n").slice(0, 5);
  const hidden = Math.max(0, rows.length - 3);
  async function copy() {
    try {
      await copyText(text, format === "notion" ? notionHtml(judges) : undefined);
      toast(`Copied ${rows.length} link${rows.length === 1 ? "" : "s"}`);
      setOpen(false);
    } catch { toast.error("Could not copy. Try again, or copy each judge's link."); }
  }
  const commands = useMemo<Command[]>(() => [
    { id: "judges-copy-text", group: "This page", label: "Copy all judge links for WhatsApp or Slack", disabled: rows.length === 0, run: () => { setFormat("text"); void copyText(judgeLinksText(eventName, judges, "text")).then(() => toast(`Copied ${rows.length} links`)); } },
    { id: "judges-copy-notion", group: "This page", label: "Copy all judge links as a Notion table", disabled: rows.length === 0, run: () => { void copyText(judgeLinksText(eventName, judges, "notion"), notionHtml(judges)).then(() => toast(`Copied ${rows.length} links`)); } },
  ], [eventName, judges, rows.length]);
  useCommands("judges-copy", commands);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>Copy all links<ChevronDown aria-hidden /></PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} className={styles.copyPopover}>
      <div role="tablist" aria-label="Format" className="dq-segmented w-full">
        <button type="button" role="tab" aria-selected={format === "text"} onClick={() => setFormat("text")}>WhatsApp or Slack</button>
        <button type="button" role="tab" aria-selected={format === "notion"} onClick={() => setFormat("notion")}>Notion table</button>
      </div>
      {rows.length === 0 ? <p className={styles.empty}>No active judge has a link yet. Add judges, or turn one back on.</p>
        : <pre className={styles.preview} aria-label="What gets copied">{previewLines.join("\n")}{hidden > 0 ? `\n…${hidden} more` : ""}</pre>}
      <Button className="w-full" onClick={() => void copy()} disabled={rows.length === 0}>Copy {rows.length} link{rows.length === 1 ? "" : "s"}</Button>
      <p className={styles.note}>Notion table pastes as two columns, Judge and Link. Only active judges are included.</p>
    </PopoverContent>
  </Popover>;
}

/** One judge's link and the fixes: Replace link, Move scores to…, Turn off or on. */
function JudgeFixes({ slug, judge, judges, judgingStatus, titleById, moving, setMoving }: { slug: string; judge: JudgeRow; judges: JudgeRow[]; judgingStatus: JudgesOverview["judgingStatus"]; titleById: ReadonlyMap<string, string>; moving: boolean; setMoving: (open: boolean) => void }) {
  const convex = useConvex();
  const createJudgeAccess = useMutation(api.judging.createJudgeAccess);
  const replaceJudgeLink = useMutation(api.judging.replaceJudgeLink);
  const deactivateJudgeAccess = useMutation(api.judging.deactivateJudgeAccess);
  const applyRedistribution = useMutation(api.judging.applyRedistribution);
  const [confirm, setConfirm] = useState<"replace" | "off" | null>(null);
  const [offPlan, setOffPlan] = useState<RedistributionPlan | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const assigned = judgingStatus === "ready" || judgingStatus === "open" || judgingStatus === "closed";
  useEffect(() => { setConfirm(null); setOffPlan(null); setOverrides({}); }, [judge.judgeKey]);

  async function act(action: () => Promise<unknown>, done: string, failure: string) {
    setBusy(true);
    try { await action(); toast(done); setConfirm(null); } catch (error) { toast.error(errorText(error, failure)); } finally { setBusy(false); }
  }
  async function askTurnOff() {
    if (!assigned) { setConfirm("off"); return; }
    setBusy(true);
    try { setOffPlan(await convex.query(api.judging.previewRedistribution, { slug, unavailableJudgeKey: judge.judgeKey })); setOverrides({}); setConfirm("off"); }
    catch (error) { toast.error(errorText(error, "Could not plan who takes their projects.")); }
    finally { setBusy(false); }
  }
  const turnOff = () => offPlan
    ? act(() => applyRedistribution({ slug, unavailableJudgeKey: judge.judgeKey, assignments: offPlan.map((row) => ({ submissionId: row.submissionId, judges: overrides[String(row.submissionId)] ?? row.judges })) }), `Turned off ${judge.judgeName}`, "Could not turn the judge off.")
    : act(() => deactivateJudgeAccess({ slug, judgeKey: judge.judgeKey, active: false }), `Turned off ${judge.judgeName}`, "Could not turn the judge off.");
  const others = judges.filter((row) => row.active && row.judgeKey !== judge.judgeKey);

  return <div className={styles.fixes}>
    {judge.path ? <div className={styles.linkBox}><span className="dq-mono">{shortLink(judge.path)}</span><Button variant="outline" size="xs" onClick={() => void copyJudgeLink(judge)}><Copy aria-hidden />Copy link</Button></div>
      : <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => createJudgeAccess({ slug, judgeName: judge.judgeName, capabilityToken: randomToken() }), `Made a link for ${judge.judgeName}`, "Could not make the link.")}>Make a link</Button>}
    <div className={styles.fixButtons}>
      <Button variant="outline" size="sm" disabled={!judge.hasLink || busy} onClick={() => setConfirm("replace")}>Replace link</Button>
      <ShortcutTooltip label="Move scores to another judge" keys={["M"]}><Button variant="outline" size="sm" disabled={busy || judges.length < 2} onClick={() => setMoving(true)}>Move scores to…</Button></ShortcutTooltip>
      {judge.hasLink && !judge.active
        ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => deactivateJudgeAccess({ slug, judgeKey: judge.judgeKey, active: true }), `Turned ${judge.judgeName} back on`, "Could not turn the judge on.")}>Turn on</Button>
        : <Button variant="outline" size="sm" disabled={busy || !judge.hasLink} onClick={() => void askTurnOff()}>Turn off</Button>}
    </div>
    <p className={styles.note}>Moving scores and turning off can be undone from Recent changes. A replaced link stops working.</p>
    <Dialog open={confirm === "replace"} onOpenChange={(next) => setConfirm(next ? "replace" : null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace {judge.judgeName}&apos;s link?</DialogTitle><DialogDescription>The old link stops working at once, and Opened clears until they confirm on the new one. Their scores stay. A replaced link can&apos;t be brought back.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button disabled={busy} onClick={() => void act(() => replaceJudgeLink({ slug, judgeKey: judge.judgeKey, capabilityToken: randomToken() }), `Replaced ${judge.judgeName}'s link. Send them the new one.`, "Could not replace the link.")}>Replace link</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirm === "off"} onOpenChange={(next) => { if (!next) { setConfirm(null); setOffPlan(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Turn off {judge.judgeName}?</DialogTitle><DialogDescription>{offPlan ? `Their link stops working. ${offPlan.length} unscored project${offPlan.length === 1 ? "" : "s"} move${offPlan.length === 1 ? "s" : ""} to other judges; scores they gave stay.` : "Their link stops working. Turn it back on any time."} You can undo this from Recent changes.</DialogDescription></DialogHeader>
        {offPlan && offPlan.length > 0 && <ul className={styles.planList} aria-label="Who takes their projects">
          {offPlan.map((row) => {
            const id = String(row.submissionId);
            const kept = row.previousJudges.find((name) => name !== judge.judgeName) ?? row.previousJudges[0];
            const chosen = (overrides[id] ?? row.judges).find((name) => name !== kept) ?? "";
            return <li key={id} className={styles.planRow}>
              <span className={styles.planTitle}>{titleById.get(id) ?? "A project"}</span>
              <Select value={chosen} onValueChange={(value) => setOverrides((current) => ({ ...current, [id]: row.previousJudges.map((name) => (name === judge.judgeName ? String(value) : name)) }))}>
                <SelectTrigger className={styles.planSelect} aria-label={`Who takes ${titleById.get(id) ?? "this project"}`}><SelectValue /></SelectTrigger>
                <SelectContent>{others.filter((candidate) => candidate.judgeName !== kept).map((candidate) => <SelectItem key={candidate.judgeKey} value={candidate.judgeName}>{candidate.judgeName}</SelectItem>)}</SelectContent>
              </Select>
            </li>;
          })}
        </ul>}
        <DialogFooter><Button variant="outline" onClick={() => { setConfirm(null); setOffPlan(null); }} disabled={busy}>Cancel</Button><Button disabled={busy} onClick={() => void turnOff()}>Turn off</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <MoveScoresDialog slug={slug} from={judge} judges={judges} open={moving} onOpenChange={setMoving} />
  </div>;
}

function MoveScoresDialog({ slug, from, judges, open, onOpenChange }: { slug: string; from: JudgeRow; judges: JudgeRow[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const moveJudgeScores = useMutation(api.judging.moveJudgeScores);
  const targets = judges.filter((row) => row.judgeKey !== from.judgeKey);
  const [to, setTo] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState<Set<string>>(new Set());
  useEffect(() => { if (open) { setTo(targets[0]?.judgeKey ?? ""); setError(""); setLeft(new Set()); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = targets.find((row) => row.judgeKey === to);
  // A project the other judge already reviewed can't move: it would overwrite their score.
  const clashes = new Set((target?.reviewedProjects ?? []).map((project) => String(project.submissionId)));
  const projects = from.reviewedProjects.map((project) => ({ ...project, clash: clashes.has(String(project.submissionId)) }));
  const chosen = projects.filter((project) => !project.clash && !left.has(String(project.submissionId)));
  const clashCount = projects.filter((project) => project.clash).length;
  async function move() {
    setBusy(true); setError("");
    try {
      await moveJudgeScores({ slug, fromJudgeKey: from.judgeKey, toJudgeKey: to, submissionIds: chosen.map((project) => project.submissionId as Id<"submissions">) });
      toast(`Moved ${chosen.length} of ${from.judgeName}'s scores to ${target?.judgeName ?? "the other judge"}`);
      onOpenChange(false);
    } catch (failure) { setError(errorText(failure, "Could not move the scores.")); } finally { setBusy(false); }
  }
  const toggle = (id: string) => setLeft((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Move {from.judgeName}&apos;s scores</DialogTitle><DialogDescription>For when someone scored on the wrong link. {projects.length === 0 ? `${from.judgeName} has no scores to move.` : clashCount > 0 ? `${target?.judgeName ?? "The other judge"} already scored ${clashCount === 1 ? "one of these" : `${clashCount} of these`}, so ${clashCount === 1 ? "it stays" : "they stay"} with ${from.judgeName}.` : "Choose the projects to move."}</DialogDescription></DialogHeader>
      <label className={styles.field}><span>Move to</span>
        <Select value={to} onValueChange={(value) => setTo(String(value))}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose a judge" /></SelectTrigger>
          <SelectContent>{targets.map((row) => <SelectItem key={row.judgeKey} value={row.judgeKey}>{row.judgeName}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      {projects.length > 0 && <ul className={styles.moveList} aria-label="Projects to move">
        {projects.map((project) => {
          const id = String(project.submissionId);
          return <li key={id}><label className={styles.moveRow} data-disabled={project.clash ? "" : undefined}>
            <Checkbox checked={!project.clash && !left.has(id)} disabled={project.clash || busy} onCheckedChange={() => toggle(id)} />
            <span>{project.demoTitle}</span>
            {project.clash && <span className={styles.moveNote}>{target?.judgeName} already scored this</span>}
          </label></li>;
        })}
      </ul>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button disabled={busy || !to || chosen.length === 0} onClick={() => void move()}>{chosen.length === 0 ? "Move scores" : `Move ${chosen.length} score${chosen.length === 1 ? "" : "s"}`}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
