"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { stageSubmissionPrompt } from "@/lib/event-state";
import type { StagePresentationData, StageTimerData } from "@/lib/stage-presentation";
import { cn } from "@/lib/utils";
import { isOutpostStyle, normalizeVisualStyle } from "@/lib/visual-style";

function formatTimer(ms: number) {
  const totalSeconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absoluteSeconds = Math.abs(totalSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const seconds = absoluteSeconds % 60;
  return `${totalSeconds < 0 ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
}

type TimerUrgency = "normal" | "warning" | "danger";

function timerUrgency(remainingMs: number, durationMs: number): TimerUrgency {
  if (durationMs <= 0) return "normal";
  if (remainingMs <= 0) return "danger";
  const fractionLeft = remainingMs / durationMs;
  if (remainingMs <= 30_000 || fractionLeft <= 0.1) return "danger";
  if (fractionLeft <= 0.25) return "warning";
  return "normal";
}

function useStageTimer(timer: StageTimerData | undefined) {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [receivedAt, setReceivedAt] = useState(() => Date.now());

  useEffect(() => {
    setReceivedAt(Date.now());
    setClientNow(Date.now());
  }, [timer?.serverNow, timer?.endsAt, timer?.remainingMs, timer?.status]);

  useEffect(() => {
    if (!timer || timer.status !== "running") return;

    const interval = window.setInterval(() => setClientNow(Date.now()), 250);
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

export function StagePresentation({
  stage,
  submissionUrl,
  embedded = false,
}: {
  stage: StagePresentationData;
  submissionUrl: string;
  embedded?: boolean;
}) {
  const visualStyle = normalizeVisualStyle(stage.event.visualStyle);
  const isOutpost = isOutpostStyle(visualStyle);
  const isHackathon = stage.event.eventType === "hackathon";
  const lineupNoun = isHackathon ? "presenter" : "demoer";
  const projectNoun = isHackathon ? "project" : "demo";
  const currentId = stage.current?.id ?? "empty";
  const lineupIds = stage.lineup.map((item) => item.id).join("-") || "empty";
  const isLive = stage.event.queuePublished;
  const allUpcoming = stage.lineup.slice(1);
  const [visibleUpcomingLimit, setVisibleUpcomingLimit] = useState<number | null>(null);
  const visibleUpcomingCount =
    allUpcoming.length === 0 ? 0 : Math.max(1, visibleUpcomingLimit ?? allUpcoming.length);
  const upcoming = allUpcoming.slice(0, visibleUpcomingCount);
  const hiddenLineupCount = Math.max(stage.remainingCount - 1 - upcoming.length, 0);
  const displayMeetUrl = stage.meetUrl
    ? stage.meetUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : "";
  const stageRootRef = useRef<HTMLElement | null>(null);
  const lineupStackRef = useRef<HTMLDivElement | null>(null);
  const lineupListRef = useRef<HTMLOListElement | null>(null);
  const previousCurrentId = useRef<string | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const queueTimer = useStageTimer(stage.stageTimer);
  const demoTimer = useStageTimer(stage.demoTimer);
  const showQueueTimer = stage.event.showStageTimerOnStage;
  const showQrStage = stage.event.stageScreenMode === "qr";
  const showSubmissionCount = stage.event.showSubmissionCountOnStage;
  const showDemoTimer =
    !showQrStage && isLive && Boolean(stage.current) && stage.event.showDemoTimerOnStage;
  const queueTimerUrgency = timerUrgency(queueTimer.remainingMs, queueTimer.durationMs);
  const queueTimerFraction =
    queueTimer.durationMs > 0
      ? Math.min(Math.max(queueTimer.remainingMs / queueTimer.durationMs, 0), 1)
      : 0;
  const demoTimerStateClass = showDemoTimer
    ? ` is-${demoTimer.status}${demoTimer.remainingMs < 0 ? " is-overtime" : ""}`
    : "";
  const waitingCount = stage.waitingCount;
  const liveLineupIsComplete = isLive && !stage.current && stage.remainingCount === 0;
  const currentStageLabel = stage.current
    ? isHackathon
      ? "Now presenting"
      : "Now demoing"
    : liveLineupIsComplete
      ? `All ${isHackathon ? "presentations" : "demos"} complete`
      : isLive
        ? "Waiting for presenter"
        : isHackathon
          ? "Now presenting"
          : "Now demoing";
  const currentStageTitle =
    (isOutpost ? stage.current?.demoTitle : stage.current?.teamName ?? stage.current?.name) ??
    (isLive
      ? liveLineupIsComplete
        ? `End of the ${isHackathon ? "presentation" : "demo"} lineup`
        : `No ${lineupNoun} selected`
      : `Submit your ${projectNoun} here`);
  const currentStageSubtitle =
    (isOutpost ? stage.current?.description : stage.current?.demoTitle) ??
    (isLive
      ? liveLineupIsComplete
        ? "Thanks for watching."
        : `Waiting for the next ${projectNoun}.`
      : stage.event.name);

  useEffect(() => {
    if (!isLive || allUpcoming.length === 0) {
      setVisibleUpcomingLimit(0);
      return;
    }

    let frame: number | null = null;

    function measureUpcomingLimit() {
      if (frame !== null) window.cancelAnimationFrame(frame);

      frame = window.requestAnimationFrame(() => {
        frame = null;
        const root = stageRootRef.current;
        const stack = lineupStackRef.current;
        const list = lineupListRef.current;
        const rows = list ? (Array.from(list.children) as HTMLElement[]) : [];

        if (!root || !stack || !list || rows.length === 0) {
          setVisibleUpcomingLimit(allUpcoming.length);
          return;
        }

        const rootStyle = window.getComputedStyle(root);
        const listStyle = window.getComputedStyle(list);
        const bottomPadding = Number.parseFloat(rootStyle.paddingBottom) || 0;
        const rowGap = Number.parseFloat(listStyle.rowGap) || Number.parseFloat(listStyle.gap) || 0;
        const rowHeights = rows
          .map((row) => row.getBoundingClientRect().height)
          .filter((height) => height > 0);
        const fallbackRowHeight = Math.max(...rowHeights);

        if (!Number.isFinite(fallbackRowHeight) || fallbackRowHeight <= 0) {
          setVisibleUpcomingLimit(allUpcoming.length);
          return;
        }

        const rootRect = root.getBoundingClientRect();
        const stackRect = stack.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const embeddedScale =
          embedded && root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1;
        const listTop = embedded
          ? (listRect.top - rootRect.top) / embeddedScale
          : listRect.top;
        const reservedBelowList = embedded
          ? Math.max((stackRect.bottom - listRect.bottom) / embeddedScale, 0)
          : Math.max(stackRect.bottom - listRect.bottom, 0);
        const boundaryBottom = embedded ? root.offsetHeight : window.innerHeight;
        const availableListHeight = Math.max(
          boundaryBottom - bottomPadding - listTop - reservedBelowList,
          0,
        );

        let nextLimit = 0;
        let usedHeight = 0;

        for (let index = 0; index < allUpcoming.length; index += 1) {
          const rowHeight = rowHeights[index] ?? fallbackRowHeight;
          const nextHeight = usedHeight + rowHeight + (nextLimit > 0 ? rowGap : 0);
          if (nextHeight > availableListHeight) break;
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
    if (stageRootRef.current) resizeObserver.observe(stageRootRef.current);
    if (lineupStackRef.current) resizeObserver.observe(lineupStackRef.current);
    if (lineupListRef.current) resizeObserver.observe(lineupListRef.current);
    window.addEventListener("resize", measureUpcomingLimit);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureUpcomingLimit);
    };
  }, [allUpcoming.length, embedded, hiddenLineupCount, isLive, lineupIds, stage.meetUrl]);

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
    if (previousCurrentId.current === currentId) return;

    previousCurrentId.current = currentId;
    setIsAdvancing(true);
    const timeout = window.setTimeout(() => setIsAdvancing(false), 760);
    return () => window.clearTimeout(timeout);
  }, [currentId, isLive]);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      aria-hidden={embedded ? true : undefined}
      className={cn("stage", isOutpost && "stage-outpost", isAdvancing && "stage-advancing")}
      inert={embedded ? true : undefined}
      ref={(node: HTMLElement | null) => {
        stageRootRef.current = node;
      }}
    >
      {isOutpost ? (
        <Image
          className="outpost-stage-mark"
          src="/outpost/logo-white.png"
          alt="Outpost"
          width={260}
          height={85}
          priority
        />
      ) : (
        <span className="codex-mark stage-mark" aria-hidden />
      )}
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
                <span>
                  {stage.remainingCount} {lineupNoun}{stage.remainingCount === 1 ? "" : "s"}
                </span>
              </div>
              {upcoming.length > 0 ? (
                <ol className="stage-lineup-list" ref={lineupListRef}>
                  {upcoming.map((item, index) => (
                    <li className={index === 0 ? "is-next" : "is-later"} key={item.id}>
                      <span className="stage-lineup-position">
                        {index === 0 ? "Up next" : `#${index + 2}`}
                      </span>
                      <span className="stage-lineup-copy">
                        <span className="stage-lineup-person">
                          {isOutpost ? item.demoTitle : item.teamName ?? item.name}
                        </span>
                        <span className="stage-lineup-demo">
                          {isOutpost ? item.description : item.demoTitle}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="stage-lineup-empty">
                  <h2>
                    {stage.current
                      ? `End of the ${isHackathon ? "presentation" : "demo"} lineup`
                      : `No more ${isHackathon ? "presenters" : "demos"} queued`}
                  </h2>
                  <p>
                    {stage.current
                      ? `This is the last ${projectNoun}.`
                      : `The ${isHackathon ? "presentation" : "demo"} lineup is complete.`}
                  </p>
                </div>
              )}
              {hiddenLineupCount > 0 ? (
                <p className="stage-lineup-more">
                  +{hiddenLineupCount} more published {lineupNoun}
                  {hiddenLineupCount === 1 ? "" : "s"}
                </p>
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
                  <h3 style={{ marginTop: 14 }}>{stageSubmissionPrompt(stage.event.eventType)}</h3>
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
    </Root>
  );
}
