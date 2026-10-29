"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { absoluteUrl } from "@/lib/routes";
import { randomToken } from "@/lib/tokens";
import { errorText } from "./changes";
import { timeAgo, useTick } from "./clock";
import styles from "./judges.module.css";

type Overview = FunctionReturnType<typeof api.judging.getJudgesOverview>;
type JudgeRow = Overview["judges"][number];
type Format = "text" | "notion";

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

/**
 * The Judges page: one private link per judge, who opened theirs, how far
 * they are, and the fixes for when something goes wrong on the night.
 */
export function JudgesPage({ slug, eventName, onAddJudges }: { slug: string; eventName: string; onAddJudges: () => void }) {
  const overview = useQuery(api.judging.getJudgesOverview, { slug });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const now = useTick(true);
  const judges = useMemo(() => overview?.judges ?? [], [overview]);
  const selected = judges.find((row) => row.judgeKey === selectedKey) ?? judges[0] ?? null;
  const index = selected ? judges.indexOf(selected) : -1;

  const commands = useMemo<Command[]>(() => [
    { id: "judges-next", group: "This page", label: "Next judge", keys: ["J"], run: () => setSelectedKey(judges[Math.min(index + 1, judges.length - 1)]?.judgeKey ?? null) },
    { id: "judges-previous", group: "This page", label: "Previous judge", keys: ["K"], run: () => setSelectedKey(judges[Math.max(index - 1, 0)]?.judgeKey ?? null) },
    { id: "judges-move", group: "This page", label: "Move scores to another judge", keys: ["M"], disabled: !selected, run: () => setMoving(true) },
    { id: "judges-add", group: "This page", label: "Add judges", run: onAddJudges },
  ], [judges, index, selected, onAddJudges]);
  useCommands("judges-page", commands);

  return <div className={styles.page}>
    <div className={styles.toolbar}>
      <CopyAllLinks eventName={eventName} judges={judges} disabled={!overview} />
      <Button size="sm" onClick={onAddJudges}>Add judges</Button>
    </div>
    <div className={styles.layout}>
      <div className={styles.tableWrap}>
        <div className="dq-card overflow-x-auto">
          <table className={styles.table}>
            <thead><tr><th>Judge</th><th>Link</th><th>Opened</th><th>Scored</th></tr></thead>
            <tbody>
              {overview === undefined ? [0, 1, 2, 3].map((key) => <tr key={key} aria-hidden><td><Skeleton className="h-3 w-28" /></td><td><Skeleton className="h-3 w-40" /></td><td><Skeleton className="h-3 w-16" /></td><td><Skeleton className="h-3 w-20" /></td></tr>)
                : judges.length === 0 ? <tr><td colSpan={4} className={styles.empty}>No judges yet. Add their names, and each gets a private link to score from their laptop.<div className="mt-3"><Button size="sm" variant="outline" onClick={onAddJudges}>Add judges</Button></div></td></tr>
                : judges.map((row) => <tr key={row.judgeKey} className={styles.row} data-selected={selected?.judgeKey === row.judgeKey ? "" : undefined} data-off={row.hasLink && !row.active ? "" : undefined} onClick={() => setSelectedKey(row.judgeKey)}>
                  <td><button type="button" className={styles.nameButton} onClick={() => setSelectedKey(row.judgeKey)}>{row.judgeName}</button>{!row.onRoster && <span className={styles.badge}>Not on the roster</span>}</td>
                  <td className="dq-mono">{row.path ? <span className={styles.link}>{shortLink(row.path)}</span> : <span className={styles.muted}>No link yet</span>}</td>
                  <td>{!row.hasLink ? <span className={styles.muted}>No link</span> : !row.active ? <span className={styles.muted}>Off</span> : row.openedAt ? <span className={styles.opened}><span className="dq-dot" data-tone="success" aria-hidden />{timeAgo(row.openedAt, now)}</span> : <span className={styles.notOpened}>Not opened yet</span>}</td>
                  <td className={styles.scored}>{row.assignedScoredCount} of {row.assignedCount}{row.helpedCount > 0 && <span className={styles.muted}> + {row.helpedCount} helped</span>}</td>
                </tr>)}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>Opened means the judge confirmed their name on the link. &quot;Not opened yet&quot; ten minutes before judging is the one to chase.</p>
      </div>
      {selected && <JudgeCard slug={slug} judge={selected} judges={judges} judgingStatus={overview?.judgingStatus ?? "setup"} moving={moving} setMoving={setMoving} />}
    </div>
  </div>;
}

function CopyAllLinks({ eventName, judges, disabled }: { eventName: string; judges: JudgeRow[]; disabled: boolean }) {
  const [format, setFormat] = useState<Format>("text");
  const [open, setOpen] = useState(false);
  const rows = judges.filter((judge) => judge.active && judge.path);
  const text = judgeLinksText(eventName, judges, format);
  const previewLines = format === "text" ? text.split("\n").slice(0, 6) : text.split("\n").slice(0, 5);
  const hidden = format === "text" ? Math.max(0, rows.length - 3) : Math.max(0, rows.length - 3);
  async function copy() {
    try {
      await copyText(text, format === "notion" ? notionHtml(judges) : undefined);
      toast(`Copied ${rows.length} link${rows.length === 1 ? "" : "s"}`);
      setOpen(false);
    } catch { toast.error("Could not copy. Try again, or copy each link from the table."); }
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

function JudgeCard({ slug, judge, judges, judgingStatus, moving, setMoving }: { slug: string; judge: JudgeRow; judges: JudgeRow[]; judgingStatus: Overview["judgingStatus"]; moving: boolean; setMoving: (open: boolean) => void }) {
  const convex = useConvex();
  const createJudgeAccess = useMutation(api.judging.createJudgeAccess);
  const replaceJudgeLink = useMutation(api.judging.replaceJudgeLink);
  const deactivateJudgeAccess = useMutation(api.judging.deactivateJudgeAccess);
  const applyRedistribution = useMutation(api.judging.applyRedistribution);
  const [confirm, setConfirm] = useState<"replace" | "off" | null>(null);
  const [offPlan, setOffPlan] = useState<FunctionReturnType<typeof api.judging.previewRedistribution> | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useTick(true);
  const assigned = judgingStatus === "ready" || judgingStatus === "open" || judgingStatus === "closed";
  useEffect(() => { setConfirm(null); setOffPlan(null); }, [judge.judgeKey]);

  async function act(action: () => Promise<unknown>, done: string, failure: string) {
    setBusy(true);
    try { await action(); toast(done); setConfirm(null); } catch (error) { toast.error(errorText(error, failure)); } finally { setBusy(false); }
  }
  async function copy() {
    if (!judge.path) return;
    try { await navigator.clipboard.writeText(absoluteUrl(judge.path)); toast(`Copied ${judge.judgeName}'s link`); } catch { toast.error("Could not copy the link."); }
  }
  async function askTurnOff() {
    if (!assigned) { setConfirm("off"); return; }
    setBusy(true);
    try { setOffPlan(await convex.query(api.judging.previewRedistribution, { slug, unavailableJudgeKey: judge.judgeKey })); setConfirm("off"); }
    catch (error) { toast.error(errorText(error, "Could not plan who takes their projects.")); }
    finally { setBusy(false); }
  }
  const turnOff = () => offPlan
    ? act(() => applyRedistribution({ slug, unavailableJudgeKey: judge.judgeKey, assignments: offPlan.map((row) => ({ submissionId: row.submissionId, judges: row.judges })) }), `Turned off ${judge.judgeName}`, "Could not turn the judge off.")
    : act(() => deactivateJudgeAccess({ slug, judgeKey: judge.judgeKey, active: false }), `Turned off ${judge.judgeName}`, "Could not turn the judge off.");

  return <aside className={styles.side} aria-label={judge.judgeName}>
    <section className={`dq-card ${styles.card}`}>
      <div className={styles.cardHead}><h2>{judge.judgeName}</h2><span className={styles.muted}>{judge.assignedScoredCount + judge.helpedCount} scored</span></div>
      {judge.path ? <div className={styles.linkBox}><span className="dq-mono">{shortLink(judge.path)}</span><Button variant="outline" size="xs" onClick={() => void copy()}><Copy aria-hidden />Copy</Button></div>
        : <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => createJudgeAccess({ slug, judgeName: judge.judgeName, capabilityToken: randomToken() }), `Made a link for ${judge.judgeName}`, "Could not make the link.")}>Make a link</Button>}
      <dl className={styles.facts}>
        <dt>Opened</dt><dd>{judge.openedAt ? timeAgo(judge.openedAt, now) : judge.hasLink ? "Not yet" : "No link"}</dd>
        <dt>Own list</dt><dd>{judge.assignedScoredCount} of {judge.assignedCount} scored{judge.inProgressCount > 0 ? `, ${judge.inProgressCount} started` : ""}</dd>
        <dt>Helped</dt><dd>{judge.helpedCount > 0 ? `${judge.helpedCount} other project${judge.helpedCount === 1 ? "" : "s"}` : "None yet"}</dd>
        {judge.lastScoredAt && <><dt>Last score</dt><dd>{timeAgo(judge.lastScoredAt, now)}</dd></>}
      </dl>
    </section>
    <section className={`dq-card ${styles.card}`}>
      <h3 className={styles.cardTitle}>If something goes wrong</h3>
      <div className={styles.fix}><Button variant="outline" size="sm" disabled={!judge.hasLink || busy} onClick={() => setConfirm("replace")}>Replace link</Button><span>Link went to the wrong person. The old one stops working.</span></div>
      <div className={styles.fix}><ShortcutTooltip label="Move scores to another judge" keys={["M"]}><Button variant="outline" size="sm" disabled={busy || judges.length < 2} onClick={() => setMoving(true)}>Move scores to…</Button></ShortcutTooltip><span>Someone scored on the wrong link.</span></div>
      <div className={styles.fix}>{judge.hasLink && !judge.active
        ? <><Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => deactivateJudgeAccess({ slug, judgeKey: judge.judgeKey, active: true }), `Turned ${judge.judgeName} back on`, "Could not turn the judge on.")}>Turn on</Button><span>Their link works again.</span></>
        : <><Button variant="outline" size="sm" disabled={busy || !judge.hasLink} onClick={() => void askTurnOff()}>Turn off</Button><span>{assigned ? "Their unscored projects go to others." : "Their link stops working."}</span></>}</div>
      <p className={styles.note}>Moving scores and turning a judge off can be undone from Recent changes. A replaced link can&apos;t be brought back.</p>
    </section>
    <Dialog open={confirm === "replace"} onOpenChange={(open) => setConfirm(open ? "replace" : null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace {judge.judgeName}&apos;s link?</DialogTitle><DialogDescription>The old link stops working at once, and Opened clears until they confirm on the new one. Their scores stay. A replaced link can&apos;t be brought back.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button disabled={busy} onClick={() => void act(() => replaceJudgeLink({ slug, judgeKey: judge.judgeKey, capabilityToken: randomToken() }), `Replaced ${judge.judgeName}'s link. Send them the new one.`, "Could not replace the link.")}>Replace link</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirm === "off"} onOpenChange={(open) => { if (!open) { setConfirm(null); setOffPlan(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Turn off {judge.judgeName}?</DialogTitle><DialogDescription>{offPlan ? `Their link stops working. ${offPlan.length} unscored project${offPlan.length === 1 ? "" : "s"} move${offPlan.length === 1 ? "s" : ""} to other judges; scores they gave stay.` : "Their link stops working. Turn it back on any time."} You can undo this from Recent changes.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => { setConfirm(null); setOffPlan(null); }} disabled={busy}>Cancel</Button><Button disabled={busy} onClick={() => void turnOff()}>Turn off</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <MoveScoresDialog slug={slug} from={judge} judges={judges} open={moving} onOpenChange={setMoving} />
  </aside>;
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
      await moveJudgeScores({ slug, fromJudgeKey: from.judgeKey, toJudgeKey: to, submissionIds: chosen.map((project) => project.submissionId) });
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
