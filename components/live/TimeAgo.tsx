"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "./clock";

/**
 * "just now", "4 min ago": ticks on its own every 30 seconds, which is finer
 * than anything it shows, so the list around it does not re-render with it.
 */
export function TimeAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [at]);
  return <>{timeAgo(at, now)}</>;
}
