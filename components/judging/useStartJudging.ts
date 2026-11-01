"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

type JudgingStatus = "setup" | "preparing_assignments" | "ready" | "open" | "closed";

/**
 * Starts judging from wherever it is: gives every project two judges, in
 * batches, then opens the judge links and runs the clock. A move to Judging
 * calls it, and so does Start judging; an attempt cut off half way carries on
 * from the status it reached.
 */
export function useStartJudging(slug: string) {
  const startPreparation = useMutation(api.judging.startAssignmentPreparation);
  const prepareBatch = useMutation(api.judging.prepareAssignmentBatch);
  const startJudging = useMutation(api.judging.startJudging);
  return useCallback(async (status: JudgingStatus) => {
    if (status === "open" || status === "closed") return;
    if (status === "setup") await startPreparation({ slug });
    if (status === "setup" || status === "preparing_assignments") {
      for (;;) { const result = await prepareBatch({ slug }); if (result.done) break; }
    }
    await startJudging({ slug });
  }, [slug, startPreparation, prepareBatch, startJudging]);
}
