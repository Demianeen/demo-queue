"use client";

// Route-level error boundary for the participant status page. The getParticipant
// query throws when the submission/token can't be found (e.g. the event team ran
// "Clear all", or the link is stale). Instead of the white-screen "Application
// error", show a friendly explanation.
export default function ParticipantError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(560px, 100%)" }}>
        <p className="eyebrow">Demo Queue</p>
        <h1>This submission isn&apos;t available.</h1>
        <p className="lead">
          We couldn&apos;t find this demo. The link may be out of date, or the event team may have
          cleared the queue. If you still want to present, scan the event QR code again to re-submit.
        </p>
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
