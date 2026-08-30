"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowLeftIcon, LockKeyholeIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/app/Skeleton";
import { ProjectReviewContent } from "@/components/ProjectReviewContent";
import {
  JUDGING_CRITERIA,
  JUDGING_CRITERION_LABELS,
} from "@/lib/judging-rubric";
import { adminPath } from "@/lib/routes";
import styles from "./review.module.css";

export default function AdminSubmissionReviewPage() {
  const params = useParams<{
    slug: string;
    token: string;
    submissionId: string;
  }>();
  const data = useQuery(api.judging.getAdminSubmissionReview, {
    slug: params.slug,
    adminToken: params.token,
    submissionId: params.submissionId as Id<"submissions">,
  });

  if (!data) {
    return (
      <main className={styles.loadingPage}>
        <section className={styles.loadingPanel}>
          <Skeleton w={180} h={12} />
          <Skeleton h={560} style={{ marginTop: 18 }} />
        </section>
      </main>
    );
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href={adminPath(params.slug, params.token)}>
          <ArrowLeftIcon /> Back to event
        </Link>
        <div className={styles.eventIdentity}>
          <span className={styles.privateLabel}><LockKeyholeIcon /> Admin review</span>
          <span className={styles.divider} />
          <span className={styles.eventName}>{data.eventName}</span>
        </div>
        <span className={styles.readOnly}>Read only</span>
      </header>

      <div className={styles.columns}>
        <ProjectReviewContent project={data.submission} />
        <aside className={styles.reviewsPanel}>
          <div className={styles.reviewsHeading}>
            <div>
              <h2>Judge reviews</h2>
              <p>Scores saved for this project.</p>
            </div>
          </div>
          <div className={styles.reviewList}>
            {data.reviews.map((review) => (
              <section className={styles.reviewCard} key={review.judgeName}>
                <div className={styles.reviewHeader}>
                  <strong>{review.judgeName}</strong>
                  <span>{review.completed ? "Complete" : "Pending"}</span>
                </div>
                <div className={styles.reviewScores}>
                  {JUDGING_CRITERIA.map((criterion) => (
                    <div key={criterion}>
                      <span>{JUDGING_CRITERION_LABELS[criterion]}</span>
                      <strong>{review[criterion] ?? "—"}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {data.reviews.length === 0 ? (
              <p className={styles.emptyState}>No judges are assigned to this project.</p>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
