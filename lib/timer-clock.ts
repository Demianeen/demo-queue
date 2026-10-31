/**
 * A timer as a Convex query returns it: the time left when the query ran,
 * and that query's own clock (`serverNow`).
 *
 * Convex caches a query until the data it read changes, so `serverNow` is
 * when the query last ran, not when the browser received it: it can be hours
 * old. A running timer therefore ends at `serverNow + remainingMs` (or its
 * stored `endsAt`), and the time left is that end minus the browser's clock.
 * Every surface (Overview, Judging, the judge page and the stage) reads the
 * time through here, so they all show the same clock.
 */
export type TimerReading = {
  running: boolean;
  remainingMs: number;
  serverNow: number;
  endsAt?: number | null;
};

/** When a running timer ends, in ms since the epoch. */
export function timerEndsAt(timer: TimerReading) {
  return typeof timer.endsAt === "number" ? timer.endsAt : timer.serverNow + timer.remainingMs;
}

/** Time left at `now`: negative once a running timer has run out. A paused or idle timer keeps its time. */
export function timeLeftMs(timer: TimerReading | null | undefined, now: number) {
  if (!timer) return 0;
  return timer.running ? timerEndsAt(timer) - now : timer.remainingMs;
}

/** m:ss, with a minus once the time is below zero ("-1:05"): the projector's and the submissions clock's reading. */
export function formatSignedClock(ms: number) {
  const totalSeconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absoluteSeconds = Math.abs(totalSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const seconds = absoluteSeconds % 60;
  return `${totalSeconds < 0 ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The submissions clock keeps counting below zero; once it does, its label says the deadline passed. */
export function submissionsClockLabel(remainingMs: number, label: string) {
  return remainingMs < 0 ? "Deadline passed" : label;
}
