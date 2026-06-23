"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "convex/react";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { absoluteUrl, submissionPath } from "@/lib/routes";
import { Skeleton } from "@/app/Skeleton";
import { cn } from "@/lib/utils";

type StageTimer = {
  status: "idle" | "running" | "paused";
  durationMs: number;
  remainingMs: number;
  endsAt?: number;
  serverNow: number;
};

function formatTimer(ms: number) {
  const totalSeconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absoluteSeconds = Math.abs(totalSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const seconds = absoluteSeconds % 60;
  return `${totalSeconds < 0 ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function useStageTimer(timer: StageTimer | undefined) {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [receivedAt, setReceivedAt] = useState(() => Date.now());

  useEffect(() => {
    setReceivedAt(Date.now());
    setClientNow(Date.now());
  }, [timer?.serverNow, timer?.endsAt, timer?.remainingMs, timer?.status]);

  useEffect(() => {
    if (!timer || timer.status !== "running") return;

    const interval = window.setInterval(() => {
      setClientNow(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, [timer]);

  if (!timer) {
    return {
      status: "idle" as const,
      label: "Ready",
      remainingMs: 0,
      display: "0:00",
    };
  }

  const estimatedServerNow = timer.serverNow + (clientNow - receivedAt);
  const remainingMs =
    timer.status === "running" && timer.endsAt !== undefined
      ? timer.endsAt - estimatedServerNow
      : timer.remainingMs;
  const label =
    timer.status === "running"
      ? remainingMs < 0
        ? "Over time"
        : "On clock"
      : timer.status === "paused"
        ? "Paused"
        : "Ready";

  return {
    status: timer.status,
    label,
    remainingMs,
    display: formatTimer(remainingMs),
  };
}

export default function StagePage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submissionUrl = absoluteUrl(submissionPath(params.slug));
  const isPreview = searchParams.get("preview") === "admin";
  const currentId = stage?.current?.id ?? "empty";
  const lineupIds = stage?.lineup.map((item) => item.id).join("-") ?? "empty";
  const isLive = stage?.event.queuePublished ?? false;
  const allUpcoming = stage?.lineup.slice(1) ?? [];
  const [visibleUpcomingLimit, setVisibleUpcomingLimit] = useState<number | null>(null);
  const upcoming = allUpcoming.slice(0, visibleUpcomingLimit ?? allUpcoming.length);
  const hiddenLineupCount = Math.max((stage?.remainingCount ?? 0) - 1 - upcoming.length, 0);
  const displayMeetUrl = stage?.meetUrl ? stage.meetUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const stageRootRef = useRef<HTMLElement | null>(null);
  const lineupStackRef = useRef<HTMLDivElement | null>(null);
  const lineupListRef = useRef<HTMLOListElement | null>(null);
  const previousCurrentId = useRef<string | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const queueTimer = useStageTimer(stage?.stageTimer);
  const demoTimer = useStageTimer(stage?.demoTimer);
  const showQueueTimer = stage?.event.showStageTimerOnStage ?? false;
  const showDemoTimer =
    isLive && Boolean(stage?.current) && (stage?.event.showDemoTimerOnStage ?? false);
  const queueTimerStateClass = showQueueTimer
    ? ` is-${queueTimer.status}${queueTimer.remainingMs < 0 ? " is-overtime" : ""}`
    : "";
  const demoTimerStateClass = showDemoTimer
    ? ` is-${demoTimer.status}${demoTimer.remainingMs < 0 ? " is-overtime" : ""}`
    : "";
  const waitingCount = stage?.waitingCount ?? stage?.remainingCount ?? 0;

  useEffect(() => {
    if (!isLive || allUpcoming.length === 0) {
      setVisibleUpcomingLimit(0);
      return;
    }

    let frame: number | null = null;

    function measureUpcomingLimit() {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = null;

        const root = stageRootRef.current;
        const stack = lineupStackRef.current;
        const list = lineupListRef.current;
        const rows = list ? Array.from(list.children) as HTMLElement[] : [];

        if (!root || !stack || !list || rows.length === 0) {
          setVisibleUpcomingLimit(allUpcoming.length);
          return;
        }

        const rootStyle = window.getComputedStyle(root);
        const listStyle = window.getComputedStyle(list);
        const bottomPadding = Number.parseFloat(rootStyle.paddingBottom) || 0;
        const rowGap =
          Number.parseFloat(listStyle.rowGap) ||
          Number.parseFloat(listStyle.gap) ||
          0;
        const rowHeights = rows
          .map((row) => row.getBoundingClientRect().height)
          .filter((height) => height > 0);
        const fallbackRowHeight = Math.max(...rowHeights);

        if (!Number.isFinite(fallbackRowHeight) || fallbackRowHeight <= 0) {
          setVisibleUpcomingLimit(allUpcoming.length);
          return;
        }

        const stackRect = stack.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const reservedBelowList = Math.max(stackRect.bottom - listRect.bottom, 0);
        const availableListHeight = Math.max(
          window.innerHeight - bottomPadding - listRect.top - reservedBelowList,
          0,
        );

        let nextLimit = 0;
        let usedHeight = 0;

        for (let index = 0; index < allUpcoming.length; index += 1) {
          const rowHeight = rowHeights[index] ?? fallbackRowHeight;
          const nextHeight = usedHeight + rowHeight + (nextLimit > 0 ? rowGap : 0);

          if (nextHeight > availableListHeight) {
            break;
          }

          usedHeight = nextHeight;
          nextLimit += 1;
        }

        const cappedLimit = Math.max(1, Math.min(allUpcoming.length, nextLimit));
        setVisibleUpcomingLimit((currentLimit) =>
          currentLimit === cappedLimit ? currentLimit : cappedLimit,
        );
      });
    }

    measureUpcomingLimit();

    const resizeObserver = new ResizeObserver(measureUpcomingLimit);
    if (lineupStackRef.current) resizeObserver.observe(lineupStackRef.current);
    if (lineupListRef.current) resizeObserver.observe(lineupListRef.current);
    window.addEventListener("resize", measureUpcomingLimit);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureUpcomingLimit);
    };
  }, [allUpcoming.length, hiddenLineupCount, isLive, lineupIds, stage?.meetUrl]);

  useEffect(() => {
    if (!isLive) {
      previousCurrentId.current = null;
      setIsAdvancing(false);
      return;
    }

    if (previousCurrentId.current === null) {
      previousCurrentId.current = currentId;
      return;
    }

    if (previousCurrentId.current === currentId) {
      return;
    }

    previousCurrentId.current = currentId;
    setIsAdvancing(true);

    const timeout = window.setTimeout(() => {
      setIsAdvancing(false);
    }, 760);

    return () => window.clearTimeout(timeout);
  }, [currentId, isLive]);

  if (!stage) {
    return (
      <main className={cn("stage", isPreview && "stage-preview-mode")}>
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

  return (
    <main
      className={cn("stage", isAdvancing && "stage-advancing", isPreview && "stage-preview-mode")}
      ref={stageRootRef}
    >
      <span className="codex-mark stage-mark" aria-hidden />
      <section className="stage-grid">
        <div className="stage-main">
          <div className="stage-current-content" key={currentId}>
            <p className="stage-label">Now demoing</p>
            <div className="stage-title">{stage.current?.name ?? "Queue opening soon"}</div>
            <div className="stage-subtitle">{stage.current?.demoTitle ?? stage.event.name}</div>
            {showDemoTimer ? (
              <div className={`stage-demo-timer${demoTimerStateClass}`} aria-live="polite">
                <span>{demoTimer.label}</span>
                <strong>{demoTimer.display}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="stage-side">
          {isLive ? (
            <div className="stage-lineup-stack" key={lineupIds} ref={lineupStackRef}>
              <div className="stage-lineup-header">
                <p className="stage-label">Coming up</p>
                <span>{stage.remainingCount} in lineup</span>
              </div>
              {upcoming.length > 0 ? (
                <ol className="stage-lineup-list" ref={lineupListRef}>
                  {upcoming.map((item, index) => (
                    <li className={index === 0 ? "is-next" : "is-later"} key={item.id}>
                      <span className="stage-lineup-position">
                        {index === 0 ? "Up next" : `#${index + 2}`}
                      </span>
                      <span className="stage-lineup-copy">
                        <span className="stage-lineup-person">{item.name}</span>
                        <span className="stage-lineup-demo">{item.demoTitle}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="stage-lineup-empty">
                  <h2>End of the lineup</h2>
                  <p>This is the last demo.</p>
                </div>
              )}
              {hiddenLineupCount > 0 ? (
                <p className="stage-lineup-more">+{hiddenLineupCount} more in the published lineup</p>
              ) : null}
              {stage.meetUrl ? (
                <div className="stage-access">
                  <span className="stage-access-label">Stage access</span>
                  <a className="stage-meet-url" href={stage.meetUrl} target="_blank" rel="noreferrer">
                    {displayMeetUrl}
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="stage-qr-shell">
              <div className="stage-qr-stack">
                <Image
                  src="/mascot.png"
                  alt=""
                  aria-hidden
                  width={130}
                  height={110}
                  priority
                  className="stage-mascot"
                />
                <div className="qr-box">
                  <QRCodeSVG value={submissionUrl} size={264} marginSize={2} />
                  <h3 style={{ marginTop: 14 }}>Scan to demo</h3>
                </div>
              </div>
              {showQueueTimer ? (
                <div className={`stage-timer-strip${queueTimerStateClass}`} aria-live="polite">
                  <div className="stage-timer-strip-clock">
                    <span>{queueTimer.label}</span>
                    <strong>{queueTimer.display}</strong>
                  </div>
                  <div className="stage-timer-strip-count">
                    <span>In queue</span>
                    <strong>{waitingCount}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
