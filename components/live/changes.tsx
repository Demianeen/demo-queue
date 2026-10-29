"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { memberNames } from "@/app/(workspace)/members/actions";
import { timeAgo, useTick } from "./clock";
import styles from "./live.module.css";

export type RecentChange = FunctionReturnType<typeof api.changes.listRecentChanges>["changes"][number];

/** How many changes the live home and the Undo toast read. One subscription serves both. */
export const RECENT_LIMIT = 20;

let namesPromise: Promise<Record<string, string>> | null = null;

/** Members' names by WorkOS user id, loaded once per page load. */
export function useMemberNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    namesPromise ??= memberNames().catch(() => ({}));
    void namesPromise.then((value) => { if (live) setNames(value); });
    return () => { live = false; };
  }, []);
  return names;
}

export function whoDid(change: Pick<RecentChange, "isYou" | "via" | "actorUserId">, names: Record<string, string>) {
  const name = change.isYou ? "You" : (change.actorUserId && names[change.actorUserId]) || "A teammate";
  return change.via === "assistant" ? `${name}, via assistant` : name;
}

function initials(label: string) {
  const parts = label.replace(/,.*$/, "").split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2)).toUpperCase();
}

/** "Changed again since: undo …" and friends, as one short line. */
export function useUndo(slug: string) {
  const undoChange = useMutation(api.changes.undoChange);
  return async (change: Pick<RecentChange, "id" | "summary">) => {
    try {
      await undoChange({ slug, changeId: change.id });
      toast(`Undid "${change.summary}"`);
    } catch (error) {
      toast.error(errorText(error, "Could not undo that change."));
    }
  };
}

export function errorText(error: unknown, fallback: string) {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  if (error instanceof Error && error.message && !/Server Error|Uncaught/.test(error.message)) return error.message;
  return fallback;
}

/**
 * Shows an Undo toast right after each change you make on this event, from
 * any control, by watching Recent changes for a new row of yours.
 */
export function UndoToaster({ slug }: { slug: string }) {
  const data = useQuery(api.changes.listRecentChanges, { slug, limit: RECENT_LIMIT });
  const seen = useRef<Set<string> | null>(null);
  const undo = useUndo(slug);
  useEffect(() => {
    if (!data) return;
    if (!seen.current) { seen.current = new Set(data.changes.map((change) => change.id)); return; }
    for (const change of [...data.changes].reverse()) {
      if (seen.current.has(change.id)) continue;
      seen.current.add(change.id);
      if (!change.isYou || change.isUndo || change.via !== "app") continue;
      toast(`You ${change.summary}`, {
        id: `change-${change.id}`,
        duration: 8000,
        action: change.canUndo ? { label: change.undoLabel, onClick: () => void undo(change) } : undefined,
        description: change.canUndo ? undefined : change.undoBlockedReason ?? undefined,
      });
    }
  }, [data, undo]);
  return null;
}

/** The Recent changes card: who did what, when, and Undo / Restore / Reopen, or why not. */
export function RecentChanges({ slug, compact = 5 }: { slug: string; compact?: number }) {
  const data = useQuery(api.changes.listRecentChanges, { slug, limit: RECENT_LIMIT });
  const names = useMemberNames();
  const undo = useUndo(slug);
  const [all, setAll] = useState(false);
  const now = useTick(true);
  const rows = data ? (all ? data.changes : data.changes.slice(0, compact)) : [];
  const more = data ? data.changes.length > compact || data.hasMore : false;
  return <section className={`dq-card ${styles.sideCard}`} aria-labelledby="recent-changes">
    <div className={styles.sideHead}>
      <h2 id="recent-changes">Recent changes</h2>
      {more && <button type="button" className={styles.linkButton} onClick={() => setAll((value) => !value)}>{all ? "Show fewer" : "See all"}</button>}
    </div>
    {data === undefined ? <div className={styles.changeList} aria-label="Loading recent changes">{[0, 1, 2].map((key) => <div key={key} className={styles.changeRow}><Skeleton className="size-5 rounded-full" /><Skeleton className="h-3 flex-1" /></div>)}</div>
      : rows.length === 0 ? <p className={styles.empty}>No changes yet. What you and your team change on this event shows here, with Undo.</p>
      : <ol className={styles.changeList}>{rows.map((change) => {
        const who = whoDid(change, names);
        return <li key={change.id} className={styles.changeRow} data-undone={change.undoneAt !== null ? "" : undefined}>
          <span className={styles.avatar} aria-hidden data-you={change.isYou ? "" : undefined}>{initials((change.actorUserId && names[change.actorUserId]) || (change.isYou ? "You" : "A teammate"))}</span>
          <div className={styles.changeText}>
            <p><strong>{who}</strong> {change.summary}<span className={styles.changeWhen}> · {timeAgo(change.createdAt, now)}</span></p>
            {!change.canUndo && change.undoBlockedReason && change.undoneAt === null && <p className={styles.changeBlocked}>{change.undoBlockedReason}</p>}
          </div>
          {change.canUndo ? <Button variant="link" size="xs" className={styles.undoLink} onClick={() => void undo(change)} aria-label={`${change.undoLabel}: ${change.summary}`}>{change.undoLabel}</Button>
            : change.undoneAt !== null ? <span className={styles.changeDone}>Undone</span> : null}
        </li>;
      })}</ol>}
    <p className={styles.note}>Most changes can be undone from here, and from the toast right after you make it.</p>
  </section>;
}
