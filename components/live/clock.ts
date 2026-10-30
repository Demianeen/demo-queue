"use client";

import { useEffect, useState } from "react";
import { timeLeftMs } from "@/lib/timer-clock";

/** A timer as the server sends it: time left now, and when it ends if it runs. */
export type ServerTimer = {
  status: "idle" | "running" | "paused";
  remainingMs: number;
  endsAt?: number | null;
  serverNow: number;
};

/** 18:42, or 1:05:00 past an hour. Never below 0:00. */
export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Reads what an organiser typed: "15" is 15 minutes, "15:00" or "15.00" is
 * mm:ss, "1:05:00" is h:mm:ss. Null when it is not a time.
 */
export function parseClock(value: string): number | null {
  const text = value.trim().replace(/\./g, ":");
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(text)) return null;
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some((part) => part > 59)) return null;
  const [h, m, s] = parts.length === 3 ? parts : parts.length === 2 ? [0, parts[0], parts[1]] : [0, parts[0], 0];
  return ((h * 60 + m) * 60 + s) * 1000;
}

/** Re-renders every half second while `active`. */
export function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** Time left on a server timer, counting down locally while it runs. See `lib/timer-clock.ts`. */
export function useRemaining(timer: ServerTimer | null | undefined) {
  const running = timer?.status === "running";
  const now = useTick(running);
  return timeLeftMs(timer && { ...timer, running }, now);
}

/** "just now", "4 min ago", "2 h ago", or a date. */
export function timeAgo(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
