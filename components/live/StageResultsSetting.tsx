"use client";

import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorText } from "./changes";
import type { AdminData, useFinalists } from "./PhaseTabs";
import styles from "./StageResultsSetting.module.css";

/**
 * What the stage shows once the event finishes: the winners and the other
 * finalists, or the winners only. Moving to Results is the reveal, for the
 * stage and every team's status page at once.
 */
export function StageResultsSetting({ slug, admin, finalists }: { slug: string; admin: AdminData; finalists: ReturnType<typeof useFinalists> }) {
  const setShowFinalists = useMutation(api.events.setStageResultsShowFinalists).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.events.getAdmin, { slug });
    if (current) store.setQuery(api.events.getAdmin, { slug }, { ...current, event: { ...current.event, stageResultsShowFinalists: args.showFinalists } });
  });
  const decision = finalists?.decision;
  const winners = decision?.placementStatus === "submitted" ? finalists!.rows.slice(0, decision.placementIds.length) : [];
  async function choose(value: string) {
    try { await setShowFinalists({ slug, showFinalists: value === "all" }); } catch (error) { toast.error(errorText(error, "Could not change what the stage shows.")); }
  }

  return <section className={styles.card} aria-labelledby="stage-results-title">
    <h2 id="stage-results-title" className={styles.title}>When the event finishes</h2>
    <p className={styles.text}>Moving to Results puts the winners on the stage and on every team&apos;s status page, at the same moment.</p>
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>The stage shows</legend>
      <RadioGroup value={admin.event.stageResultsShowFinalists ? "all" : "winners"} onValueChange={(value) => void choose(String(value))} className={styles.options}>
        <label className={styles.option}><RadioGroupItem value="all" /><span><span className={styles.optionTitle}>Winners and finalists</span><span className={styles.optionDetail}>1st to 3rd, then everyone else who pitched in the final.</span></span></label>
        <label className={styles.option}><RadioGroupItem value="winners" /><span><span className={styles.optionTitle}>Winners only</span><span className={styles.optionDetail}>1st to 3rd.</span></span></label>
      </RadioGroup>
    </fieldset>
    {finalists === null ? null : winners.length > 0
      ? <p className={styles.confirm}><Check aria-hidden className={styles.confirmIcon} />Winners submitted: {winners.map((row) => row.title).join(", ")}.</p>
      : <p className={styles.confirm} data-tone="pending">Winners are not submitted yet. Until they are, the stage and status pages show no winners.</p>}
  </section>;
}
