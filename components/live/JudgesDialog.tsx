"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { judgeInitials } from "@/lib/judging-board";
import { randomToken } from "@/lib/tokens";
import { errorText } from "./changes";
import { CopyAllLinks, MoveScoresDialog, copyJudgeLink, type JudgeRow, type JudgesOverview } from "./JudgeTools";
import { TimeAgo } from "./TimeAgo";
import styles from "./judges-dialog.module.css";

type Plan = { count: number; moves: { name: string; count: number }[]; assignments: { submissionId: JudgeRow["reviewedProjects"][number]["submissionId"]; judges: string[] }[] };
type Open = { key: string; kind: "rename" | "replace" | "off" } | null;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** Judging has handed out projects: turning a judge off moves theirs. */
const assigned = (status: JudgesOverview["judgingStatus"]) => status === "ready" || status === "open" || status === "closed";

/**
 * The Judges dialog: every judge on the list with their link, and the fixes
 * for one judge in its ⋯ menu. Each change saves at once and shows in Recent
 * changes. A judge is their key, so renaming keeps their link, projects and
 * scores (docs/judge-identity.md).
 */
export function JudgesDialog({ slug, eventName, open, onOpenChange }: { slug: string; eventName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const overview = useQuery(api.judging.getJudgesOverview, open ? { slug } : "skip");
  const [active, setActive] = useState<Open>(null);
  const [moving, setMoving] = useState<JudgeRow | null>(null);
  useEffect(() => { if (!open) { setActive(null); setMoving(null); } }, [open]);
  const judges = useMemo(() => (overview?.judges ?? []).filter((judge) => judge.onRoster), [overview]);
  const initials = useMemo(() => judgeInitials(judges.map((judge) => judge.judgeName)), [judges]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.dialog} showCloseButton={false}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <DialogTitle>Judges</DialogTitle>
          <DialogDescription>Each judge has a private link. Every project gets two judges. Changes save as you make them.</DialogDescription>
        </div>
        <CopyAllLinks eventName={eventName} judges={judges} disabled={!overview} commands={false} />
      </div>
      {!overview ? <ul className={styles.list} aria-label="Loading judges">
        {[0, 1, 2].map((index) => <li key={index} className={styles.row}><Skeleton className={styles.avatarSkeleton} /><span className={styles.main}><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></span></li>)}
      </ul>
        : judges.length === 0 ? <p className={styles.empty}>No judges yet. Add at least two: every project gets two.</p>
        : <ul className={styles.list} aria-label="Judges">
          {judges.map((judge) => <JudgeItem key={judge.judgeKey} slug={slug} judge={judge} judges={judges} overview={overview} initials={initials.get(judge.judgeName) ?? "?"}
            open={active?.key === judge.judgeKey ? active.kind : null} setOpen={(kind) => setActive(kind ? { key: judge.judgeKey, kind } : null)} onMove={() => setMoving(judge)} />)}
        </ul>}
      <AddJudges slug={slug} status={overview?.judgingStatus} />
      <div className={styles.footer}>
        <span className={styles.summary} aria-live="polite">{overview ? summary(overview, judges) : ""}</span>
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </div>
      {moving && <MoveScoresDialog slug={slug} from={moving} judges={judges} open onOpenChange={(next) => { if (!next) setMoving(null); }} />}
    </DialogContent>
  </Dialog>;
}

/** "4 judging · 1 off · 41 of 56 reviews done" */
function summary(overview: JudgesOverview, judges: JudgeRow[]) {
  const off = judges.filter((judge) => judge.hasLink && !judge.active).length;
  const linkless = judges.filter((judge) => !judge.hasLink).length;
  const parts = [`${judges.length - off - linkless} judging`];
  if (off > 0) parts.push(`${off} off`);
  if (linkless > 0) parts.push(`${linkless} without a link`);
  if (assigned(overview.judgingStatus) && overview.totals.targetReviews > 0) parts.push(`${overview.totals.completeReviews} of ${overview.totals.targetReviews} reviews done`);
  return parts.join(" · ");
}

function JudgeItem({ slug, judge, judges, overview, initials, open, setOpen, onMove }: {
  slug: string; judge: JudgeRow; judges: JudgeRow[]; overview: JudgesOverview; initials: string;
  open: "rename" | "replace" | "off" | null; setOpen: (kind: "rename" | "replace" | "off" | null) => void; onMove: () => void;
}) {
  const convex = useConvex();
  const renameJudge = useMutation(api.judging.renameJudge);
  const replaceJudgeLink = useMutation(api.judging.replaceJudgeLink);
  const removeJudge = useMutation(api.judging.removeJudge);
  const deactivateJudgeAccess = useMutation(api.judging.deactivateJudgeAccess);
  const applyRedistribution = useMutation(api.judging.applyRedistribution);
  const createJudgeAccess = useMutation(api.judging.createJudgeAccess);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(judge.judgeName);
  const [plan, setPlan] = useState<Plan | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Rename was picked from the ⋯ menu: the menu leaves focus where it is, so the name field keeps it.
  const renaming = useRef(false);
  const off = judge.hasLink && !judge.active;
  const scores = judge.assignedScoredCount + judge.helpedCount;
  const unscored = judge.assignedCount - judge.assignedScoredCount;
  const handedOut = assigned(overview.judgingStatus);

  useEffect(() => {
    if (open === "rename") { setDraft(judge.judgeName); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); }
    if (open !== "off") setPlan(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: () => Promise<unknown>, done: string, failure: string) {
    setBusy(true);
    try { await action(); toast(done); setOpen(null); return true; } catch (error) { toast.error(errorText(error, failure)); return false; } finally { setBusy(false); }
  }

  async function saveName() {
    const name = draft.trim().replace(/\s+/g, " ");
    if (name === judge.judgeName) { setOpen(null); return; }
    const saved = await act(() => renameJudge({ slug, judgeKey: judge.judgeKey, name }), `Renamed ${judge.judgeName} to ${name}`, "Could not rename the judge.");
    // Refused (an empty name, or another judge's): keep editing.
    if (!saved) requestAnimationFrame(() => input.current?.focus());
  }
  function onNameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); void saveName(); }
    if (event.key === "Escape") {
      // Cancels the rename, not the whole dialog.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(null);
    }
  }

  async function askTurnOff() {
    if (!handedOut) { setPlan({ count: 0, moves: [], assignments: [] }); setOpen("off"); return; }
    setBusy(true);
    try {
      const preview = await convex.query(api.judging.previewRedistribution, { slug, unavailableJudgeKey: judge.judgeKey });
      // Where their unscored projects go, grouped by judge: "+3 Priya Shah".
      const counts = new Map<string, number>();
      for (const row of preview) {
        const index = row.judges.findIndex((key) => !row.previousJudges.includes(key));
        const name = row.judgeNames[index];
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      setPlan({
        count: preview.length,
        moves: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        assignments: preview.map(({ submissionId, judges }) => ({ submissionId, judges })),
      });
      setOpen("off");
    } catch (error) { toast.error(errorText(error, "Could not plan who takes their projects.")); } finally { setBusy(false); }
  }
  const turnOff = () => plan && plan.count > 0
    ? act(() => applyRedistribution({ slug, unavailableJudgeKey: judge.judgeKey, assignments: plan.assignments }), `Turned off ${judge.judgeName} and moved ${plural(plan.count, "project")}`, "Could not turn the judge off.")
    : act(() => deactivateJudgeAccess({ slug, judgeKey: judge.judgeKey, active: false }), `Turned off ${judge.judgeName}`, "Could not turn the judge off.");

  const status = off
    ? <>Turned off{judge.deactivatedAt ? <> <TimeAgo at={judge.deactivatedAt} /></> : null}{scores > 0 && ` · ${plural(scores, "score")} kept`}</>
    : <>
      {open === "rename" && draft.trim() !== judge.judgeName ? <>Was {judge.judgeName} · </> : null}
      {!judge.hasLink ? "No link yet" : judge.openedAt ? <>Opened <TimeAgo at={judge.openedAt} /></> : <span className={styles.notOpened}>Link not opened</span>}
      {judge.assignedCount > 0 ? ` · ${judge.assignedScoredCount} of ${judge.assignedCount} scored` : handedOut ? " · no projects of their own" : ""}
      {judge.helpedCount > 0 && ` · helped ${judge.helpedCount}`}
    </>;

  return <li className={styles.item} data-open={open ? "" : undefined}>
    <div className={styles.row}>
      <span className={styles.avatar} data-off={off ? "" : undefined} aria-hidden>{initials}</span>
      <div className={styles.main}>
        {open === "rename"
          ? <Input ref={input} aria-label={`New name for ${judge.judgeName}`} className={styles.nameInput} value={draft} maxLength={80} disabled={busy}
            onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={onNameKey} />
          : <span className={styles.name} data-off={off ? "" : undefined}>{judge.judgeName}{off && <span className={styles.offBadge}>Off</span>}</span>}
        <span className={styles.status} data-off={off ? "" : undefined}>{status}</span>
      </div>
      {off
        ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => deactivateJudgeAccess({ slug, judgeKey: judge.judgeKey, active: true }), `Turned ${judge.judgeName} back on`, "Could not turn the judge back on.")}>Turn back on</Button>
        : judge.path
          ? <Button variant="outline" size="sm" onClick={() => void copyJudgeLink(judge)}>Copy link</Button>
          : <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => createJudgeAccess({ slug, judgeName: judge.judgeName, capabilityToken: randomToken() }), `Made a link for ${judge.judgeName}`, "Could not make the link.")}>Make link</Button>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${judge.judgeName}`} disabled={busy} />}><MoreHorizontal aria-hidden /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={styles.menu} finalFocus={() => { if (!renaming.current) return true; renaming.current = false; return false; }}>
          <DropdownMenuItem onClick={() => { renaming.current = true; setOpen("rename"); }}>Rename</DropdownMenuItem>
          {judge.hasLink && !off && <MenuItem label="Replace link" note="The old link stops working" onClick={() => setOpen("replace")} />}
          <MenuItem label="Move scores to another judge" note="For a judge who scored on the wrong link" disabled={judges.length < 2} onClick={onMove} />
          <DropdownMenuSeparator />
          {judge.hasLink && !off && <MenuItem label="Turn off" variant="destructive" onClick={() => void askTurnOff()}
            note={handedOut && unscored > 0 ? `Their ${plural(unscored, "unscored project")} go to the others` : "Their link stops working"} />}
          <MenuItem label="Remove" variant="destructive" disabled={judge.reviewedProjects.length > 0}
            note={judge.reviewedProjects.length > 0 ? "Only before they score. Turn off instead." : judge.assignedCount > 0 ? `Their ${plural(judge.assignedCount, "project")} go to the others` : "Takes them off the list"}
            onClick={() => void act(() => removeJudge({ slug, judgeKey: judge.judgeKey }), `Removed ${judge.judgeName}. Undo it from Recent changes.`, "Could not remove the judge.")} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {open === "rename" && <p className={styles.hint}>Renames everywhere. Their link, projects and scores stay. Enter saves, Escape cancels.</p>}
    {open === "replace" && <div role="alertdialog" aria-labelledby={`replace-${judge.judgeKey}`} className={styles.confirm}>
      <span id={`replace-${judge.judgeKey}`} className={styles.confirmTitle}>Replace {judge.judgeName}&apos;s link?</span>
      <span className={styles.confirmText}>The old link stops working at once. Their scores stay. Send them the new one.</span>
      <div className={styles.confirmActions}>
        <Button size="sm" disabled={busy} onClick={() => void act(() => replaceJudgeLink({ slug, judgeKey: judge.judgeKey, capabilityToken: randomToken() }), `Replaced ${judge.judgeName}'s link. Send them the new one.`, "Could not replace the link.")}>Replace link</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
      </div>
    </div>}
    {open === "off" && plan && <div role="alertdialog" aria-labelledby={`off-${judge.judgeKey}`} className={styles.confirm} data-tone="danger">
      <span id={`off-${judge.judgeKey}`} className={styles.confirmTitle}>Turn off {judge.judgeName}?</span>
      <span className={styles.confirmText}>
        Their link stops working.{scores > 0 && ` Their ${plural(scores, "score")} stay.`}
        {plan.count > 0 ? ` The ${plural(plan.count, "project")} they haven't scored go to the other judges:` : " Turn them back on any time."}
      </span>
      {plan.moves.length > 0 && <ul className={styles.moves} aria-label="Who takes their projects">
        {plan.moves.map((move) => <li key={move.name}><span className="dq-mono">+{move.count}</span> {move.name}</li>)}
      </ul>}
      <div className={styles.confirmActions}>
        <Button size="sm" className={styles.dangerButton} disabled={busy} onClick={() => void turnOff()}>{plan.count > 0 ? `Turn off and move ${plan.count}` : "Turn off"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
      </div>
    </div>}
  </li>;
}

function MenuItem({ label, note, disabled, variant, onClick }: { label: string; note: string; disabled?: boolean; variant?: "destructive"; onClick: () => void }) {
  return <DropdownMenuItem className={styles.menuItem} variant={variant} disabled={disabled} onClick={onClick}>
    <span>{label}</span><span className={styles.menuNote}>{note}</span>
  </DropdownMenuItem>;
}

/**
 * Add one judge, or paste several names one per line. Names already on the
 * list are skipped. Each new judge gets their own link at once.
 */
function AddJudges({ slug, status }: { slug: string; status: JudgesOverview["judgingStatus"] | undefined }) {
  const addJudges = useMutation(api.judging.addJudges);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const names = text.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);

  async function add() {
    if (names.length === 0) return;
    setBusy(true); setError("");
    try {
      const result = await addJudges({ slug, names });
      const skipped = result.skipped.length > 0 ? `${result.skipped.join(", ")} ${result.skipped.length === 1 ? "is" : "are"} already on the list.` : "";
      if (result.added.length > 0) toast(`Added ${result.added.length === 1 ? result.added[0].judgeName : plural(result.added.length, "judge")}${skipped ? `. ${skipped}` : ""}`);
      else toast(skipped || "Nobody new to add.");
      setText("");
    } catch (failure) { setError(errorText(failure, "Could not add the judges.")); } finally { setBusy(false); }
  }

  return <form className={styles.add} onSubmit={(event) => { event.preventDefault(); void add(); }}>
    <div className={styles.addRow}>
      <Textarea aria-label="Add judges" rows={1} className={styles.addInput} value={text} disabled={busy} placeholder="Add a judge, or paste several names"
        onChange={(event) => { setText(event.currentTarget.value); setError(""); }}
        // Enter adds; pasted names keep their lines.
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void add(); } }} />
      <Button type="submit" variant="outline" disabled={busy || names.length === 0}>{names.length > 1 ? `Add ${names.length}` : "Add"}</Button>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p>
      : <p className={styles.help}>{status && assigned(status)
        ? "Projects are already given out, so a judge added now gets none of their own. They can score any project that still needs reviews in Help out."
        : "Everyone on the list gets projects when judging starts."}</p>}
  </form>;
}
