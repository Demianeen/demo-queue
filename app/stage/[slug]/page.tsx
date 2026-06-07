"use client";

import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { absoluteUrl, submissionPath } from "@/lib/routes";

export default function StagePage() {
  const params = useParams<{ slug: string }>();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submissionUrl = absoluteUrl(submissionPath(params.slug));

  if (!stage) {
    return <main className="stage">Loading...</main>;
  }

  const isLive = stage.event.queuePublished;

  return (
    <main className="stage">
      <section
        className="stage-grid"
        style={isLive ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}
      >
        <div className="stage-main">
          <div>
            <p className="stage-label">Now demoing</p>
            <div className="stage-title">{stage.current?.demoTitle ?? "Queue opening soon"}</div>
            <div className="stage-name">{stage.current?.name ?? stage.event.name}</div>
          </div>

          <div className="stage-card">
            <p className="stage-label">Up next</p>
            <h2>{stage.upNext?.demoTitle ?? "Waiting for the first pick"}</h2>
            <p>{stage.upNext?.name ?? "Scan the QR code to submit your demo."}</p>
          </div>
        </div>

        {isLive ? null : (
          <aside className="stage-side">
            <div className="qr-box">
              <QRCodeSVG value={submissionUrl} size={264} marginSize={2} />
              <h3 style={{ marginTop: 14 }}>Scan to demo</h3>
              <p className="muted" style={{ marginBottom: 0 }}>{stage.remainingCount} waiting</p>
            </div>

            <div className="stage-card">
              <p>Queue is being prepared by the event team.</p>
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}
