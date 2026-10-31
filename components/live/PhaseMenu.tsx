"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommands, type Command } from "@/components/shell/commands";
import { phasesFor, type EventPhase } from "@/lib/event-phase";
import { phaseTabLabel } from "@/lib/admin-views";
import { formatClock } from "./clock";
import { errorText } from "./changes";
import styles from "./live.module.css";

type PhasePreview = FunctionReturnType<typeof api.phases.previewPhaseChange>;
type EventType = "demo" | "hackathon";

function confirmLabel(eventType: EventType, to: EventPhase) {
  return to === "submissions" ? "Reopen submissions" : to === "judging" ? "Reopen judging" : `Back to ${phaseTabLabel(eventType, to).toLowerCase()}`;
}

/** What a move does, from the backend's effects: "Judging pauses at 18:42. Every score is kept…" */
function effectText(preview: PhasePreview) {
  return preview.effects.map((effect) => effect.code === "judging_timer_pause" && preview.judgingRemainingMs !== null
    ? `Judging pauses at ${formatClock(preview.judgingRemainingMs)}.`
    : effect.text).join(" ");
}

/**
 * The phase control in the event's header: "● Judging ▾". Each other phase
 * says what moving there does. Forward moves happen at once (and can be
 * undone from Recent changes); a move back first asks, inline.
 */
export function PhaseMenu({ slug, eventType, phase }: { slug: string; eventType: EventType; phase: EventPhase }) {
  const convex = useConvex();
  const setPhase = useMutation(api.phases.setPhase);
  const reopenSubmissions = useMutation(api.phases.reopenSubmissions);
  const phases = useMemo(() => phasesFor(eventType), [eventType]);
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<Partial<Record<EventPhase, PhasePreview | "failed">>>({});
  const [pending, setPending] = useState<{ to: EventPhase; preview: PhasePreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Each move's effects, read when the menu opens so they match the event right now.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreviews({});
    for (const to of phases) {
      if (to === phase) continue;
      convex.query(api.phases.previewPhaseChange, { slug, phase: to })
        .then((preview) => { if (live) setPreviews((current) => ({ ...current, [to]: preview })); })
        .catch(() => { if (live) setPreviews((current) => ({ ...current, [to]: "failed" })); });
    }
    return () => { live = false; };
  }, [open, phases, phase, slug, convex]);

  useEffect(() => { if (!open) setPending(null); }, [open]);
  useEffect(() => { setPending(null); }, [phase]);
  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);

  async function move(to: EventPhase) {
    setBusy(true);
    try {
      // A hackathon's submit link reopens through its own mutation: judging pauses and every score stays.
      if (to === "submissions" && phases.includes("judging")) await reopenSubmissions({ slug });
      else await setPhase({ slug, phase: to });
      // The Undo toast comes from Recent changes, as for every other change.
      setPending(null);
      setOpen(false);
    } catch (error) {
      toast.error(errorText(error, `Could not move to ${phaseTabLabel(eventType, to)}.`));
    } finally {
      setBusy(false);
    }
  }

  async function choose(to: EventPhase) {
    if (to === phase || busy) return;
    const known = previews[to];
    let preview: PhasePreview;
    if (known && known !== "failed") preview = known;
    else {
      setBusy(true);
      try {
        preview = await convex.query(api.phases.previewPhaseChange, { slug, phase: to });
      } catch (error) {
        toast.error(errorText(error, "Could not check that move."));
        return;
      } finally {
        setBusy(false);
      }
    }
    if (preview.direction === "back") { setOpen(true); setPending({ to, preview }); return; }
    await move(to);
  }

  const commands = useMemo<Command[]>(() => phases.filter((item) => item !== phase).map((item) => ({
    id: `phase-${item}`, group: "This page", label: `Move to ${phaseTabLabel(eventType, item)}`, run: () => void choose(item),
  })), // eslint-disable-next-line react-hooks/exhaustive-deps
  [phases, phase, eventType, previews, busy]);
  useCommands("phase-menu", commands);

  const label = phaseTabLabel(eventType, phase);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={`Phase: ${label}. Change phase`} />}>
      <span className="dq-dot" data-tone={phase === "finished" ? undefined : "success"} aria-hidden />{label}<ChevronDown aria-hidden />
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} className={styles.phaseMenu}>
      {pending ? <div role="group" aria-labelledby="phase-confirm-title" className={styles.confirm} onKeyDown={(keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); setPending(null); } }}>
        <h3 id="phase-confirm-title">Back to {phaseTabLabel(eventType, pending.to).toLowerCase()}?</h3>
        <p>{effectText(pending.preview)}</p>
        <div className={styles.confirmActions}>
          <Button ref={cancelRef} variant="outline" size="sm" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void move(pending.to)} disabled={busy}>{busy ? "Moving…" : confirmLabel(eventType, pending.to)}</Button>
        </div>
      </div> : <>
        <p className={styles.phaseMenuHead}>Phase · any phase, either direction. Nothing is deleted.</p>
        {phases.map((item) => {
          const preview = previews[item];
          const current = item === phase;
          const back = phases.indexOf(item) < phases.indexOf(phase);
          return <button key={item} type="button" className={styles.phaseItem} aria-current={current ? "true" : undefined} disabled={busy && !current} onClick={() => void choose(item)}>
            <span className={styles.phaseItemTop}>
              {current ? <><span className="dq-dot" data-tone="success" aria-hidden />{phaseTabLabel(eventType, item)}<small>current</small></>
                : <>{back ? (item === "submissions" ? "Reopen submissions" : `Back to ${phaseTabLabel(eventType, item)}`) : `Move to ${phaseTabLabel(eventType, item)}`}{back && <small>asks first</small>}</>}
            </span>
            <span className={styles.phaseItemText}>
              {current ? "Live now." : preview === undefined ? <Skeleton className="h-3 w-48" /> : preview === "failed" ? "Could not check what this does. It still asks before going back." : effectText(preview)}
            </span>
          </button>;
        })}
      </>}
    </PopoverContent>
  </Popover>;
}
