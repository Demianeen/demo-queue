"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { WinnerOrder } from "@/components/judging/WinnerOrder";
import { finalistOrder, WINNER_COUNT } from "@/lib/judging-board";
import { errorText } from "./changes";
import type { useFinalists } from "./PhaseTabs";
import styles from "./live.module.css";

/**
 * The placings while the finalists pitch: the same order and the same saves
 * as Judging's Finalists, so the winners can be set from the Stage. Nothing
 * reaches the stage or the status pages before they are submitted and the
 * event moves to Results.
 */
export function StagePlacings({ slug, finalists }: { slug: string; finalists: NonNullable<ReturnType<typeof useFinalists>> }) {
  const savePlacementDraft = useMutation(api.judging.savePlacementDraft);
  const submitPlacements = useMutation(api.judging.submitPlacements);
  const { decision } = finalists;
  const serverPlacements = useMemo(() => decision.placementIds.map(String), [decision.placementIds]);
  const serverOrder = useMemo(() => finalistOrder(decision.finalistIds.map(String), serverPlacements), [decision.finalistIds, serverPlacements]);
  // A local order so a drag shows at once; it follows the server whenever that changes.
  const [order, setOrder] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const serverKey = serverOrder.join(",");
  useEffect(() => { setOrder(null); }, [serverKey]);
  const shownOrder = order ?? serverOrder;
  const winners = shownOrder.slice(0, WINNER_COUNT);
  const winnersSubmitted = decision.placementStatus === "submitted" && winners.join(",") === serverPlacements.join(",");
  const items = useMemo(() => new Map(finalists.rows.map((row) => [row.id, { title: row.title, score: row.score }])), [finalists.rows]);

  async function act(action: () => Promise<unknown>, failure: string, done?: string) {
    setBusy(true);
    try { await action(); if (done) toast(done); } catch (error) { toast.error(errorText(error, failure)); setOrder(null); } finally { setBusy(false); }
  }
  function reorder(next: string[]) {
    setOrder(next);
    // Only the winners are saved, as on Judging: a move below the line keeps them as they are.
    if (next.slice(0, WINNER_COUNT).join(",") === winners.join(",")) return;
    void act(() => savePlacementDraft({ slug, placementIds: next.slice(0, WINNER_COUNT) as Id<"submissions">[] }), "Could not save the order.");
  }

  return <section className={styles.listCard} aria-labelledby="stage-placings">
    <div className={styles.listCardHead}>
      <h2 id="stage-placings">Placings</h2>
      <span className={styles.hint}>{busy ? "Saving…" : "drag as they pitch · the top three are the winners"}</span>
    </div>
    {decision.placementStatus === "needs_review" && <p className={`${styles.hint} ${styles.placingsNote}`}>The finalists changed after the winners were picked. Check the order and submit the winners again.</p>}
    <div className={styles.placings}>
      <WinnerOrder order={shownOrder} items={items} disabled={busy} onReorder={reorder} />
    </div>
    <div className={`${styles.listFoot} ${styles.placingsFoot}`}>
      <Button size="sm" disabled={busy || winnersSubmitted} onClick={() => void act(() => submitPlacements({ slug, placementIds: winners as Id<"submissions">[] }), "Could not submit the winners.", "Winners submitted.")}>
        {winnersSubmitted ? "Winners submitted" : "Submit winners"}
      </Button>
      <span>The same order as on Judging. The stage and status pages show no winners until you submit them and move to Results.</span>
    </div>
  </section>;
}
