"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { absoluteUrl, submissionPath } from "@/lib/routes";
import { Skeleton } from "@/app/Skeleton";

export default function StagePage() {
  const params = useParams<{ slug: string }>();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submissionUrl = absoluteUrl(submissionPath(params.slug));

  if (!stage) {
    return (
      <main className="stage">
        <section className="stage-grid">
          <div className="stage-main">
            <div>
              <Skeleton w={150} h={16} radius={6} style={{ marginBottom: 18 }} />
              <Skeleton w="70%" h={84} radius={16} style={{ marginBottom: 22 }} />
              <Skeleton w={240} h={34} radius={12} />
            </div>
          </div>
          <aside className="stage-side">
            <Skeleton h={300} radius={12} />
          </aside>
        </section>
      </main>
    );
  }

  const isLive = stage.event.queuePublished;

  return (
    <main className="stage">
      <span className="codex-mark stage-mark" aria-hidden />
      <section className="stage-grid">
        <div className="stage-main">
          <div>
            <p className="stage-label">Now demoing</p>
            <div className="stage-title">{stage.current?.demoTitle ?? "Queue opening soon"}</div>
            <div className="stage-name">{stage.current?.name ?? stage.event.name}</div>
          </div>
        </div>

        <aside className="stage-side">
          {isLive ? (
            <div className="stage-card">
              <p className="stage-label">Up next</p>
              <h2>{stage.upNext?.demoTitle ?? "End of the lineup"}</h2>
              <p>{stage.upNext?.name ?? "This is the last demo."}</p>
            </div>
          ) : (
            <>
              <div className="qr-box" style={{ position: "relative" }}>
                <Image
                  src="/mascot.png"
                  alt=""
                  aria-hidden
                  width={130}
                  height={110}
                  priority
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    width: 124,
                    height: "auto",
                    transform: "translate(-50%, -62%)",
                    pointerEvents: "none",
                    filter: "drop-shadow(0 8px 10px rgba(0, 0, 0, 0.35))",
                    zIndex: 2,
                  }}
                />
                <QRCodeSVG value={submissionUrl} size={264} marginSize={2} />
                <h3 style={{ marginTop: 14 }}>Scan to demo</h3>
                <p className="muted" style={{ marginBottom: 0 }}>{stage.remainingCount} waiting</p>
              </div>

              <div className="stage-card">
                <p>Queue is being prepared by the event team.</p>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
