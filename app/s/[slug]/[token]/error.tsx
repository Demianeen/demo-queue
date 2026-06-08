"use client";

import { useParams } from "next/navigation";
import { submissionPath } from "@/lib/routes";

// Route-level error boundary for the participant status page. The getParticipant
// query throws when the submission/token can't be found (e.g. the event team ran
// "Clear all", or the link is stale). Instead of the white-screen "Application
// error", explain what happened and point them at a fresh submission form.
export default function ParticipantError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ slug: string }>();

  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(560px, 100%)" }}>
        <p className="eyebrow">Demo Queue</p>
        <h1>This submission isn&apos;t available.</h1>
        <p className="lead">
          We couldn&apos;t find this demo. The link may be out of date, or the event team may have
          cleared the queue. You can submit your demo again below.
        </p>
        <div className="actions">
          <a className="button" href={submissionPath(params.slug)}>
            Submit a new demo
          </a>
          <button className="button ghost" type="button" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
