"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminData } from "@/components/live/LiveEventHome";
import { JudgesList, type JudgesOverview } from "@/components/live/JudgeTools";
import { judgingPath } from "@/lib/admin-views";
import { REVIEW_GROUPS, reviewGroup } from "@/lib/judging-board";
import { ClockCard } from "./JudgingSide";
import { JudgingBoundary } from "./JudgingPage";
import styles from "./judging.module.css";
import { InPageLink } from "@/components/InPageLink";

/**
 * Overview's main block during the judging phase: the judging clock with
 * +5 min, Pause and Close judging, how many projects need a review (each
 * opens Judging filtered to them), and the judges, least scored first.
 */
export function JudgingNow(props: { slug: string; admin: AdminData; overview: JudgesOverview | undefined; onManageJudges: () => void }) {
  return <JudgingBoundary><JudgingNowInner {...props} /></JudgingBoundary>;
}

function JudgingNowInner({ slug, admin, overview, onManageJudges }: { slug: string; admin: AdminData; overview: JudgesOverview | undefined; onManageJudges: () => void }) {
  const status = admin.event.judgingStatus ?? "setup";
  const assigned = status === "open" || status === "closed";
  const progress = useQuery(api.judging.getAdminProgress, assigned ? { slug } : "skip");
  const counts = useMemo(() => progress && REVIEW_GROUPS.map((item) => ({
    ...item, count: progress.scoring.filter((row) => reviewGroup(row.completeReviewCount) === item.group).length,
  })), [progress]);
  return <div className={styles.now}>
    <ClockCard slug={slug} admin={admin} totals={overview?.totals} onManageJudges={onManageJudges} wide />
    {assigned && <div className={styles.groupCards} aria-label="Reviews">
      {counts ? counts.map((item) => <InPageLink key={item.group} href={judgingPath(slug, { group: item.group })} className={`dq-card ${styles.groupCard}`}>
        <span>{item.label}</span><strong>{item.count}</strong><span className={styles.muted}>{item.note}</span>
      </InPageLink>)
        : REVIEW_GROUPS.map((item) => <div key={item.group} className={`dq-card ${styles.groupCard}`} aria-hidden>
          <span>{item.label}</span><Skeleton className="h-6 w-8" /><Skeleton className="h-3 w-20" />
        </div>)}
    </div>}
    <JudgesList slug={slug} overview={overview} />
  </div>;
}
