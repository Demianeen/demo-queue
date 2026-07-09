"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
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

type TimerUrgency = "normal" | "warning" | "danger";

// 30s floor keeps a red phase on short timers where 10% would be near-instant.
function timerUrgency(remainingMs: number, durationMs: number): TimerUrgency {
  if (durationMs <= 0) return "normal";
  if (remainingMs <= 0) return "danger";
  const fractionLeft = remainingMs / durationMs;
  if (remainingMs <= 30_000 || fractionLeft <= 0.1) return "danger";
  if (fractionLeft <= 0.25) return "warning";
  return "normal";
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
      durationMs: 0,
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
    durationMs: timer.durationMs,
    display: formatTimer(remainingMs),
  };
}

export default function StagePage() {
  const params = useParams<{ slug: string }>();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submissionUrl = absoluteUrl(submissionPath(params.slug));
  const currentId = stage?.current?.id ?? "empty";
  const lineupIds = stage?.lineup.map((item) => item.id).join("-") ?? "empty";
  const isLive = stage?.event.queuePublished ?? false;
  const allUpcoming = stage?.lineup.slice(1) ?? [];
  const [visibleUpcomingLimit, setVisibleUpcomingLimit] = useState<number | null>(null);
  const visibleUpcomingCount =
    allUpcoming.length === 0 ? 0 : Math.max(1, visibleUpcomingLimit ?? allUpcoming.length);
  const upcoming = allUpcoming.slice(0, visibleUpcomingCount);
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
  const showQrStage = (stage?.event.stageScreenMode ?? (isLive ? "demo" : "qr")) === "qr";
  const showSubmissionCount = stage?.event.showSubmissionCountOnStage ?? false;
  const showDemoTimer =
    !showQrStage && isLive && Boolean(stage?.current) && (stage?.event.showDemoTimerOnStage ?? false);
  const queueTimerUrgency = timerUrgency(queueTimer.remainingMs, queueTimer.durationMs);
  const queueTimerFraction =
    queueTimer.durationMs > 0
      ? Math.min(Math.max(queueTimer.remainingMs / queueTimer.durationMs, 0), 1)
      : 0;
  const demoTimerStateClass = showDemoTimer
    ? ` is-${demoTimer.status}${demoTimer.remainingMs < 0 ? " is-overtime" : ""}`
    : "";
  const waitingCount = stage?.waitingCount ?? stage?.remainingCount ?? 0;
  const liveLineupIsComplete = isLive && !stage?.current && (stage?.remainingCount ?? 0) === 0;
  const currentStageLabel = stage?.current
    ? "Now demoing"
    : liveLineupIsComplete
      ? "All demos complete"
      : isLive
        ? "Waiting for presenter"
        : "Now demoing";
  const currentStageTitle =
    stage?.current?.name ?? (isLive ? (liveLineupIsComplete ? "End of the demo list" : "No demoer selected") : "Submit your demo here");
  const currentStageSubtitle =
    stage?.current?.demoTitle ?? (isLive ? (liveLineupIsComplete ? "Thanks for watching." : "Waiting for the next demo.") : stage?.event.name);

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

  return (
    <main
      className={cn("stage", isAdvancing && "stage-advancing")}
      ref={stageRootRef}
    >
      <span className="codex-mark stage-mark" aria-hidden />
      <section className="stage-grid">
        {showQrStage ? (
          <div className="stage-main stage-qr-main">
            {showQueueTimer ? (
              <div
                className={`stage-queue-timer is-${queueTimer.status} is-${queueTimerUrgency}`}
                aria-live="polite"
              >
                <span>{queueTimer.label}</span>
                <strong>{queueTimer.display}</strong>
                <div className="stage-queue-timer-track" aria-hidden>
                  <div
                    className="stage-queue-timer-fill"
                    style={{ width: `${queueTimerFraction * 100}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className="stage-title">{stage.event.name}</div>
          </div>
        ) : (
          <div className="stage-main">
            <div className="stage-current-content" key={currentId}>
              <p className="stage-label">{currentStageLabel}</p>
              <div className="stage-title">{currentStageTitle}</div>
              <div className="stage-subtitle">{currentStageSubtitle}</div>
              {showDemoTimer ? (
                <div className={`stage-demo-timer${demoTimerStateClass}`} aria-live="polite">
                  <span>{demoTimer.label}</span>
                  <strong>{demoTimer.display}</strong>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <aside className="stage-side">
          {!showQrStage ? (
            <div className="stage-lineup-stack" key={lineupIds} ref={lineupStackRef}>
              <div className="stage-lineup-header">
                <p className="stage-label">Coming up</p>
                <span>{stage.remainingCount} demoer{stage.remainingCount === 1 ? "" : "s"}</span>
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
                  <h2>{stage.current ? "End of the demo list" : "No more demos queued"}</h2>
                  <p>{stage.current ? "This is the last demo." : "The demo list is complete."}</p>
                </div>
              )}
              {hiddenLineupCount > 0 ? (
                <p className="stage-lineup-more">+{hiddenLineupCount} more published demoer{hiddenLineupCount === 1 ? "" : "s"}</p>
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
                  <h3 style={{ marginTop: 14 }}>Submit your demo</h3>
                </div>
              </div>
              {showSubmissionCount ? (
                <p className="stage-qr-count" aria-live="polite">
                  {waitingCount} in queue
                </p>
              ) : null}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
