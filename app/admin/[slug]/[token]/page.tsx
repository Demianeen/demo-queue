"use client";

import React, { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { stagePath } from "@/lib/routes";
import { randomToken } from "@/lib/tokens";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { makeSamplePerson } from "@/lib/sampleData";
import { Skeleton } from "@/app/Skeleton";
import { Brand } from "@/app/Brand";
import { SUBMISSION_FIELD_LIMITS, firstFieldLimitError } from "@/lib/validation";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  Clock,
  GripVertical,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  MoreHorizontal,
} from "lucide-react";

type AdminSubmission = {
  id: Id<"submissions">;
  name: string;
  demoTitle: string;
  description: string;
  phone: string;
  email?: string;
  twitter?: string;
  linkedin?: string;
  category?: string;
  status: string;
  queueOrder?: number;
};

type SubmissionFields = {
  name: string;
  demoTitle: string;
  description: string;
  phone: string;
  email: string;
  twitter: string;
  linkedin: string;
  category: string;
};

type ColumnId = "lineup" | "pool";
type AdminTab = "all" | "lineup";
type RosterStatus = "lineup" | "pool" | "hidden" | "inactive";
type StatusTone = "green" | "blue" | "yellow";

type RosterRow = AdminSubmission & {
  positionLabel?: string;
  rosterStatus: RosterStatus;
  statusLabel: string;
  statusTone: StatusTone;
};

type StageTimer = {
  status: "idle" | "running" | "paused";
  durationMs: number;
  remainingMs: number;
  endsAt?: number;
  serverNow: number;
};

const DEFAULT_STAGE_TIMER_MS = 5 * 60 * 1000;
const MIN_STAGE_TIMER_MS = 0;
const MIN_STAGE_TIMER_DURATION_MS = 60 * 1000;
const MAX_STAGE_TIMER_MS = 99 * 60 * 1000;
const MIN_OVERTIME_TIMER_MS = -MAX_STAGE_TIMER_MS;

function formatTimerMs(ms: number) {
  const totalSeconds = ms < 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const absoluteSeconds = Math.abs(totalSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const seconds = absoluteSeconds % 60;
  return `${totalSeconds < 0 ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function timerInputToMs(value: string, fallbackMs: number) {
  const minutes = Number.parseFloat(value);
  if (!Number.isFinite(minutes)) return fallbackMs;
  return Math.max(MIN_STAGE_TIMER_DURATION_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(minutes * 60 * 1000)));
}

function timerMsToInputMinutes(ms: number) {
  return String(Math.max(1, Math.round(ms / 60000)));
}

function normalizeTimerInputValue(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.max(1, Math.min(99, Number.parseInt(digits, 10))));
}

function clampTimerMs(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_STAGE_TIMER_MS;
  return Math.max(MIN_STAGE_TIMER_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(value)));
}

function clampSignedTimerMs(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_STAGE_TIMER_MS;
  return Math.max(MIN_OVERTIME_TIMER_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(value)));
}

function timersMatchForOptimisticClear(serverTimer: StageTimer, optimisticTimer: StageTimer) {
  if (serverTimer.status !== optimisticTimer.status) return false;
  if (serverTimer.durationMs !== optimisticTimer.durationMs) return false;

  if (optimisticTimer.status === "running") {
    return (
      serverTimer.endsAt !== undefined &&
      optimisticTimer.endsAt !== undefined &&
      Math.abs(serverTimer.endsAt - optimisticTimer.endsAt) < 5_000
    );
  }

  return Math.abs(serverTimer.remainingMs - optimisticTimer.remainingMs) < 5_000;
}

function useTimerView(timer: StageTimer | undefined) {
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
      label: "ready",
      remainingMs: 0,
      display: formatTimerMs(0),
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
        ? "over time"
        : "on clock"
      : timer.status === "paused"
        ? "paused"
        : "ready";

  return {
    status: timer.status,
    label,
    remainingMs,
    display: formatTimerMs(remainingMs),
  };
}

export default function AdminPage() {
  const params = useParams<{ slug: string; token: string }>();
  const admin = useQuery(api.events.getAdmin, {
    slug: params.slug,
    adminToken: params.token,
  });

  const publishQueue = useMutation(api.events.publishQueue);
  const hideSubmission = useMutation(api.events.hideSubmission);
  const restoreSubmission = useMutation(api.events.restoreSubmission);
  const pickNext = useMutation(api.events.pickNext);
  const skipCurrent = useMutation(api.events.skipCurrent);
  const markNoShow = useMutation(api.events.markNoShow);
  const clearQueue = useMutation(api.events.clearQueue);
  const adminAddSubmission = useMutation(api.events.adminAddSubmission);
  const updateSubmission = useMutation(api.events.updateSubmission);
  const setLineupTarget = useMutation(api.events.setLineupTarget);
  const setStageMeetLinkVisible = useMutation(api.events.setStageMeetLinkVisible);
  const startStageTimer = useMutation(api.events.startStageTimer);
  const pauseStageTimer = useMutation(api.events.pauseStageTimer);
  const resetStageTimer = useMutation(api.events.resetStageTimer);
  const adjustStageTimer = useMutation(api.events.adjustStageTimer);
  const shuffleLineup = useMutation(api.events.shuffleLineup);
  const aiShuffle = useAction(api.ai.aiShuffle);

  const reorderLineup = useMutation(api.events.reorderLineup).withOptimisticUpdate(
    (store, args) => {
      const qa = { slug: args.slug, adminToken: args.adminToken };
      const cur = store.getQuery(api.events.getAdmin, qa);
      if (!cur) return;
      const byId = new Map(
        [...cur.lineup, ...cur.pool, ...cur.hidden].map((e) => [e.id, e] as const),
      );
      const orderedIds = uniqueSubmissionIds(args.orderedIds);
      const ordered = new Set(orderedIds);
      const newLineup = orderedIds
        .map((id) => byId.get(id))
        .filter((e): e is (typeof cur.lineup)[number] => Boolean(e));
      store.setQuery(api.events.getAdmin, qa, {
        ...cur,
        lineup: newLineup,
        pool: cur.pool.filter((e) => !ordered.has(e.id)),
        hidden: cur.hidden.filter((e) => !ordered.has(e.id)),
      });
    },
  );

  const moveToPool = useMutation(api.events.moveToPool).withOptimisticUpdate(
    (store, args) => {
      const qa = { slug: args.slug, adminToken: args.adminToken };
      const cur = store.getQuery(api.events.getAdmin, qa);
      if (!cur) return;
      const item = cur.lineup.find((e) => e.id === args.submissionId);
      if (!item || cur.pool.some((e) => e.id === args.submissionId)) return;
      store.setQuery(api.events.getAdmin, qa, {
        ...cur,
        lineup: cur.lineup.filter((e) => e.id !== args.submissionId),
        pool: [...cur.pool, item],
      });
    },
  );

  const [editingId, setEditingId] = useState<Id<"submissions"> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [activeId, setActiveId] = useState<Id<"submissions"> | null>(null);
  const [liveMenuOpen, setLiveMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("all");
  const [timerMinutesInput, setTimerMinutesInput] = useState("");
  const [timerOverride, setTimerOverride] = useState<StageTimer | null>(null);
  const [board, setBoard] = useState<{ lineup: Id<"submissions">[]; pool: Id<"submissions">[] }>({
    lineup: [],
    pool: [],
  });
  const liveMenuRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemsById = useMemo(() => {
    const map = new Map<Id<"submissions">, AdminSubmission>();
    admin?.lineup.forEach((item) => map.set(item.id, item));
    admin?.pool.forEach((item) => map.set(item.id, item));
    admin?.hidden.forEach((item) => map.set(item.id, item));
    admin?.completed.forEach((item) => map.set(item.id, item));
    admin?.noShows.forEach((item) => map.set(item.id, item));
    admin?.withdrawn.forEach((item) => map.set(item.id, item));
    return map;
  }, [admin?.lineup, admin?.pool, admin?.hidden, admin?.completed, admin?.noShows, admin?.withdrawn]);

  // Mirror the server lists into local board state for drag previews, but never
  // while a drag is in flight (that would yank a card out from under the cursor).
  useEffect(() => {
    if (activeId || !admin) return;
    const lineup = uniqueSubmissionIds(admin.lineup.map((item) => item.id));
    const lineupSet = new Set(lineup);
    setBoard({
      lineup,
      pool: uniqueSubmissionIds(admin.pool.map((item) => item.id).filter((id) => !lineupSet.has(id))),
    });
  }, [admin, activeId]);

  const timerDurationMs = admin?.event.stageTimer?.durationMs;
  useEffect(() => {
    if (timerDurationMs === undefined) return;
    setTimerMinutesInput(timerMsToInputMinutes(timerDurationMs));
  }, [timerDurationMs]);

  const effectiveStageTimer = timerOverride ?? admin?.event.stageTimer;
  const stageTimerView = useTimerView(effectiveStageTimer);

  useEffect(() => {
    const serverTimer = admin?.event.stageTimer;
    if (!timerOverride || !serverTimer) return;
    if (timersMatchForOptimisticClear(serverTimer, timerOverride)) {
      setTimerOverride(null);
    }
  }, [admin?.event.stageTimer, timerOverride]);

  useEffect(() => {
    if (!liveMenuOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (liveMenuRef.current?.contains(event.target as Node)) return;
      setLiveMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLiveMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [liveMenuOpen]);

  if (!admin) {
    return (
      <main className="page">
        <div className="shell">
          <Skeleton w={90} h={12} radius={6} style={{ marginBottom: 14 }} />
          <Skeleton w={320} h={40} radius={12} style={{ marginBottom: 18 }} />
          <section className="admin-grid">
            <div className="panel panel-pad" style={{ display: "grid", gap: 12 }}>
              <Skeleton w={140} h={22} radius={8} style={{ marginBottom: 6 }} />
              <Skeleton h={88} radius={16} />
              <Skeleton h={88} radius={16} />
              <Skeleton h={88} radius={16} />
            </div>
            <div className="panel panel-pad" style={{ display: "grid", gap: 12 }}>
              <Skeleton w={120} h={22} radius={8} style={{ marginBottom: 6 }} />
              <Skeleton h={88} radius={16} />
              <Skeleton h={88} radius={16} />
              <Skeleton h={88} radius={16} />
            </div>
          </section>
        </div>
      </main>
    );
  }

  const queueIsLive = admin.event.queuePublished;
  const lineupTarget = admin.event.lineupTarget;

  function columnOf(id: Id<"submissions"> | ColumnId): ColumnId | null {
    if (id === "lineup" || id === "pool") return id as ColumnId;
    if (board.lineup.includes(id as Id<"submissions">)) return "lineup";
    if (board.pool.includes(id as Id<"submissions">)) return "pool";
    return null;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as Id<"submissions">);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as Id<"submissions">;
    const fromCol = columnOf(activeId);
    const toCol = columnOf(over.id as Id<"submissions"> | ColumnId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    setBoard((prev) => {
      const fromItems = prev[fromCol].filter((id) => id !== activeId);
      const toItems = [...prev[toCol]];
      const overIsContainer = over.id === toCol;
      const overIndex = overIsContainer
        ? toItems.length
        : toItems.indexOf(over.id as Id<"submissions">);
      const insertAt = overIndex >= 0 ? overIndex : toItems.length;
      toItems.splice(insertAt, 0, activeId);
      return { ...prev, [fromCol]: fromItems, [toCol]: toItems };
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const draggedId = active.id as Id<"submissions">;
    const startedIn = admin!.lineup.some((e) => e.id === draggedId) ? "lineup" : "pool";

    let finalBoard = board;
    if (over) {
      const col = columnOf(draggedId);
      const overCol = columnOf(over.id as Id<"submissions"> | ColumnId);
      if (col && overCol && col === overCol) {
        const items = board[col];
        const oldIndex = items.indexOf(draggedId);
        // `over` can be a sibling card or the column container itself (when the
        // pointer is over padding/empty space) - in that case drop at the end.
        const newIndex =
          over.id === col ? items.length - 1 : items.indexOf(over.id as Id<"submissions">);
        if (oldIndex !== newIndex && newIndex >= 0) {
          finalBoard = { ...board, [col]: arrayMove(items, oldIndex, newIndex) };
          setBoard(finalBoard);
        }
      }
    }

    setActiveId(null);

    const endedInPool = finalBoard.pool.includes(draggedId);
    // Commit: rewrite the lineup order (also pulls in a person dragged from the
    // pool), and explicitly send anyone dragged out back to the pool.
    if (startedIn === "lineup" && endedInPool) {
      await moveToPool({ slug: params.slug, adminToken: params.token, submissionId: draggedId });
    }
    if (finalBoard.lineup.length > 0) {
      await reorderLineup({
        slug: params.slug,
        adminToken: params.token,
        orderedIds: finalBoard.lineup,
      });
    }
  }

  async function publish() {
    await publishQueue({ slug: params.slug, adminToken: params.token });
  }

  async function shuffle() {
    if (queueIsLive) return;
    // Draw a fresh random lineup from everyone in the lineup or pool, up to the
    // lineup target; the rest go back to the pool.
    await shuffleLineup({ slug: params.slug, adminToken: params.token });
  }

  async function runAiShuffle() {
    if (queueIsLive || aiBusy) return;
    setAiError("");
    setAiBusy(true);
    try {
      await aiShuffle({
        slug: params.slug,
        adminToken: params.token,
        prompt:
          aiPrompt.trim() ||
          "Balance demo categories and avoid back-to-back similar topics; favor first-time demoers.",
      });
      setAiOpen(false);
    } catch {
      setAiError("AI shuffle failed. Make sure the OpenAI key is set in Convex, then try again.");
    } finally {
      setAiBusy(false);
    }
  }

  async function hide(id: Id<"submissions">) {
    await hideSubmission({ slug: params.slug, adminToken: params.token, submissionId: id });
  }

  async function restore(id: Id<"submissions">) {
    await restoreSubmission({ slug: params.slug, adminToken: params.token, submissionId: id });
  }

  async function addToLineup(id: Id<"submissions">) {
    if (board.lineup.includes(id)) return;
    await reorderLineup({
      slug: params.slug,
      adminToken: params.token,
      orderedIds: [...board.lineup, id],
    });
  }

  async function removeFromLineup(id: Id<"submissions">) {
    await moveToPool({ slug: params.slug, adminToken: params.token, submissionId: id });
  }

  async function next() {
    if (!queueIsLive) return;
    setLiveMenuOpen(false);
    await pickNext({ slug: params.slug, adminToken: params.token });
  }

  async function skip() {
    if (!queueIsLive) return;
    setLiveMenuOpen(false);
    await skipCurrent({ slug: params.slug, adminToken: params.token });
  }

  async function noShow() {
    if (!queueIsLive || !currentLineupItem) return;
    setLiveMenuOpen(false);
    await markNoShow({
      slug: params.slug,
      adminToken: params.token,
    });
  }

  async function toggleStageMeetLink(visible: boolean) {
    await setStageMeetLinkVisible({
      slug: params.slug,
      adminToken: params.token,
      visible,
    });
  }

  function showTimerImmediately(timer: StageTimer) {
    setTimerOverride(timer);
  }

  function updateTimerMinutesInput(value: string) {
    const nextValue = normalizeTimerInputValue(value);
    setTimerMinutesInput(nextValue);
    if (!effectiveStageTimer || stageTimerView.status === "running") return;

    const parsedMinutes = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsedMinutes)) return;

    const now = Date.now();
    const durationMs = timerInputToMs(nextValue, effectiveStageTimer.durationMs);
    showTimerImmediately({
      status: stageTimerView.status,
      durationMs,
      remainingMs: durationMs,
      endsAt: undefined,
      serverNow: now,
    });
  }

  function commitTimerMinutesInput() {
    if (timerMinutesInput) return;
    setTimerMinutesInput(timerMsToInputMinutes(effectiveStageTimer?.durationMs ?? DEFAULT_STAGE_TIMER_MS));
  }

  async function startTimer() {
    const now = Date.now();
    const durationMs = timerInputToMs(
      timerMinutesInput,
      effectiveStageTimer?.durationMs ?? DEFAULT_STAGE_TIMER_MS,
    );
    const remainingMs =
      stageTimerView.status === "paused" && stageTimerView.remainingMs > 0
        ? stageTimerView.remainingMs
        : durationMs;

    showTimerImmediately({
      status: "running",
      durationMs,
      remainingMs,
      endsAt: now + remainingMs,
      serverNow: now,
    });
    await startStageTimer({ slug: params.slug, adminToken: params.token, durationMs });
  }

  async function pauseTimer() {
    const now = Date.now();
    showTimerImmediately({
      status: "paused",
      durationMs: effectiveStageTimer?.durationMs ?? DEFAULT_STAGE_TIMER_MS,
      remainingMs: stageTimerView.remainingMs,
      endsAt: undefined,
      serverNow: now,
    });
    await pauseStageTimer({ slug: params.slug, adminToken: params.token });
  }

  async function resetTimer() {
    const durationMs = timerInputToMs(
      timerMinutesInput,
      effectiveStageTimer?.durationMs ?? DEFAULT_STAGE_TIMER_MS,
    );
    showTimerImmediately({
      status: "idle",
      durationMs,
      remainingMs: durationMs,
      endsAt: undefined,
      serverNow: Date.now(),
    });
    await resetStageTimer({
      slug: params.slug,
      adminToken: params.token,
      durationMs,
    });
    setTimerMinutesInput(timerMsToInputMinutes(durationMs));
  }

  async function adjustTimer(deltaMs: number) {
    const now = Date.now();
    const nextRemainingMs =
      stageTimerView.status === "running"
        ? clampSignedTimerMs(stageTimerView.remainingMs + deltaMs)
        : clampTimerMs(stageTimerView.remainingMs + deltaMs);
    showTimerImmediately({
      status: stageTimerView.status,
      durationMs: effectiveStageTimer?.durationMs ?? DEFAULT_STAGE_TIMER_MS,
      remainingMs: nextRemainingMs,
      endsAt: stageTimerView.status === "running" ? now + nextRemainingMs : undefined,
      serverNow: now,
    });
    await adjustStageTimer({
      slug: params.slug,
      adminToken: params.token,
      deltaMs,
    });
  }

  async function saveNew(values: SubmissionFields) {
    await adminAddSubmission({
      slug: params.slug,
      adminToken: params.token,
      participantToken: randomToken(32),
      name: values.name,
      demoTitle: values.demoTitle,
      description: values.description,
      phone: values.phone,
      email: values.email || undefined,
      twitter: values.twitter || undefined,
      linkedin: values.linkedin || undefined,
      category: values.category || undefined,
      queueOrder: Date.now(),
      list: "lineup",
    });
    setIsAdding(false);
  }

  async function addTestPeople() {
    const countInput = window.prompt("How many test people should I add to the pool? Max 1000.", "100");
    const count = Number.parseInt(countInput ?? "", 10);
    if (!Number.isFinite(count) || count <= 0) return;

    const safeCount = Math.min(count, 1000);
    const batchSize = 25;

    for (let start = 0; start < safeCount; start += batchSize) {
      const batchCount = Math.min(batchSize, safeCount - start);
      await Promise.all(
        Array.from({ length: batchCount }, async () => {
          const person = makeSamplePerson();
          await adminAddSubmission({
            slug: params.slug,
            adminToken: params.token,
            participantToken: randomToken(32),
            name: person.name,
            demoTitle: person.demoTitle,
            description: person.description,
            phone: person.phone,
            email: person.email,
            twitter: person.twitter,
            linkedin: person.linkedin,
            category: person.category,
            queueOrder: Date.now(),
            list: "pool",
          });
        }),
      );
    }
  }

  async function clearAll() {
    const confirmed = window.confirm(
      "Delete ALL submissions for this event? This permanently removes everyone and resets the event to its blank, pre-publish state. This cannot be undone.",
    );
    if (!confirmed) return;
    setEditingId(null);
    setIsAdding(false);
    await clearQueue({ slug: params.slug, adminToken: params.token });
  }

  async function saveEdit(id: Id<"submissions">, values: SubmissionFields) {
    await updateSubmission({
      slug: params.slug,
      adminToken: params.token,
      submissionId: id,
      name: values.name,
      demoTitle: values.demoTitle,
      description: values.description,
      phone: values.phone,
      email: values.email || undefined,
      twitter: values.twitter || undefined,
      linkedin: values.linkedin || undefined,
      category: values.category || undefined,
    });
    setEditingId(null);
  }

  async function commitTarget(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    await setLineupTarget({ slug: params.slug, adminToken: params.token, target: parsed });
  }

  const activeItem = activeId ? itemsById.get(activeId) : null;
  const lineupCount = board.lineup.length;
  const hiddenSubmissions = admin.hidden ?? [];
  const inactiveSubmissions = [
    ...(admin.completed ?? []),
    ...(admin.noShows ?? []),
    ...(admin.withdrawn ?? []),
  ];
  const allPeopleRows = buildRosterRows(
    { hidden: hiddenSubmissions, inactive: inactiveSubmissions },
    board,
    itemsById,
  );
  const timerIsRunning = stageTimerView.status === "running";
  const currentLineupItem = board.lineup[0] ? itemsById.get(board.lineup[0]) : null;

  return (
    <main className="page">
      <div className="shell">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <Brand label="Admin" />
            <h1 style={{ marginBottom: 12 }}>{admin.event.name}</h1>

            <div className="status-strip">
              <span className={queueIsLive ? "pill green" : "pill yellow"}>
                {queueIsLive ? "Queue is live" : "Not live yet"}
              </span>
              <span className="pill">{lineupCount} in lineup</span>
              <span className="pill">{board.pool.length} in pool</span>
              <span className="pill">{hiddenSubmissions.length} hidden</span>
            </div>

            <div className="actions" style={{ marginBottom: 14 }}>
              {queueIsLive ? (
                <div className="split-action" ref={liveMenuRef}>
                  <Button className="split-action-main" onClick={next} type="button">
                    Advance
                  </Button>
                  <Button
                    aria-expanded={liveMenuOpen}
                    aria-haspopup="menu"
                    aria-label="More live queue actions"
                    className="split-action-trigger"
                    onClick={() => setLiveMenuOpen((open) => !open)}
                    type="button"
                  >
                    <ChevronDown size={16} aria-hidden />
                  </Button>
                  {liveMenuOpen ? (
                    <div className="split-action-menu" role="menu">
                      <button className="split-action-item" onClick={skip} role="menuitem" type="button">
                        <span>Skip for now</span>
                        <small>Move current presenter to the bottom of the lineup.</small>
                      </button>
                      <button
                        className="split-action-item"
                        disabled={!currentLineupItem}
                        onClick={noShow}
                        role="menuitem"
                        type="button"
                      >
                        <span>Mark no-show</span>
                        <small>Remove current presenter and list them under No-shows.</small>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Button onClick={publish} type="button">
                  Make queue live
                </Button>
              )}
              {!queueIsLive ? (
                <Button variant="outline" onClick={shuffle} type="button">
                  Shuffle lineup
                </Button>
              ) : null}
              {!queueIsLive ? (
                <Button variant="outline" onClick={() => setAiOpen((open) => !open)} type="button">
                  AI shuffle
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => {
                  setActiveTab("lineup");
                  setIsAdding(true);
                }}
                type="button"
              >
                Add person
              </Button>
              <Button variant="ghost" onClick={addTestPeople} type="button">
                Add test people
              </Button>
              {allPeopleRows.length > 0 ? (
                <Button variant="destructive" onClick={clearAll} type="button">
                  Clear all
                </Button>
              ) : null}
            </div>

            {!queueIsLive && aiOpen ? (
              <div className="ai-shuffle-row">
                <input
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") runAiShuffle();
                  }}
                  placeholder="Prioritize first-time founders, avoid back-to-back same category"
                />
                <Button variant="outline" onClick={runAiShuffle} disabled={aiBusy} type="button">
                  {aiBusy ? "Thinking..." : "Run"}
                </Button>
                <Button variant="ghost" onClick={() => setAiOpen(false)} disabled={aiBusy} type="button">
                  Cancel
                </Button>
                {aiError ? (
                  <span className="ai-shuffle-error">{aiError}</span>
                ) : null}
              </div>
            ) : null}

            <div className="field" style={{ maxWidth: 520 }}>
              <div className="field-heading">
                <label htmlFor="meetUrl">Meet link</label>
                <label className="stage-meet-toggle">
                  <input
                    type="checkbox"
                    checked={admin.event.showMeetLinkOnStage ?? false}
                    disabled={!queueIsLive}
                    onChange={(event) => toggleStageMeetLink(event.currentTarget.checked)}
                  />
                  <span>Show on stage</span>
                </label>
              </div>
              <input id="meetUrl" readOnly value={admin.event.meetUrl} />
              <span className="muted" style={{ fontSize: 12 }}>
                Published lineup participants see it on their status pages. Stage visibility is off
                unless you enable it after publishing.
              </span>
            </div>

            <div className={`stage-timer-admin${stageTimerView.remainingMs < 0 ? " is-overtime" : ""}`}>
              <div className="stage-timer-admin-heading">
                <span className="stage-timer-admin-title">
                  <Clock size={16} aria-hidden />
                  Stage timer
                </span>
                <span className={`pill ${timerIsRunning ? (stageTimerView.remainingMs < 0 ? "yellow" : "green") : ""}`}>
                  {stageTimerView.label}
                </span>
              </div>
              <div className="stage-timer-admin-body">
                <div className="stage-timer-readout">{stageTimerView.display}</div>
                <div className="stage-timer-controls" aria-label="Stage timer controls">
                  <Button
                    variant={timerIsRunning ? "outline" : "default"}
                    onClick={timerIsRunning ? pauseTimer : startTimer}
                    type="button"
                  >
                    {timerIsRunning ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
                    {timerIsRunning ? "Pause" : "Start"}
                  </Button>
                  <Button variant="outline" onClick={resetTimer} type="button">
                    <RotateCcw size={16} aria-hidden />
                    Reset
                  </Button>
                  <Button
                    aria-label="Subtract 1 minute"
                    variant="outline"
                    onClick={() => adjustTimer(-60 * 1000)}
                    type="button"
                  >
                    <Minus size={16} aria-hidden />
                    1m
                  </Button>
                  <Button
                    aria-label="Add 1 minute"
                    variant="outline"
                    onClick={() => adjustTimer(60 * 1000)}
                    type="button"
                  >
                    <Plus size={16} aria-hidden />
                    1m
                  </Button>
                  <Button
                    aria-label="Add 5 minutes"
                    variant="outline"
                    onClick={() => adjustTimer(5 * 60 * 1000)}
                    type="button"
                  >
                    <Plus size={16} aria-hidden />
                    5m
                  </Button>
                </div>
                <label className="stage-timer-duration">
                  <span>Minutes</span>
                  <input
                    aria-label="Timer length in minutes"
                    inputMode="numeric"
                    maxLength={2}
                    pattern="[0-9]*"
                    type="text"
                    value={timerMinutesInput}
                    onBlur={commitTimerMinutesInput}
                    onChange={(event) => updateTimerMinutesInput(event.currentTarget.value)}
                  />
                </label>
              </div>
            </div>
          </div>

          <StagePreviewPanel
            eventName={admin.event.name}
            isLive={queueIsLive}
            slug={params.slug}
          />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <section className="panel admin-workspace">
            <div className="admin-tabs" role="tablist" aria-label="Admin views">
              <button
                aria-selected={activeTab === "all"}
                className={activeTab === "all" ? "admin-tab is-active" : "admin-tab"}
                onClick={() => setActiveTab("all")}
                role="tab"
                type="button"
              >
                <span>All people</span>
                <span className="admin-tab-count">{allPeopleRows.length}</span>
              </button>
              <button
                aria-selected={activeTab === "lineup"}
                className={activeTab === "lineup" ? "admin-tab is-active" : "admin-tab"}
                onClick={() => setActiveTab("lineup")}
                role="tab"
                type="button"
              >
                <span>Lineup</span>
                <span className="admin-tab-count">{lineupCount}</span>
              </button>
            </div>

            {activeTab === "all" ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Person</th>
                      <th>Demo</th>
                      <th>Category</th>
                      <th>Contact</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPeopleRows.length === 0 ? (
                      <tr>
                        <td className="admin-empty-cell" colSpan={6}>
                          No one has joined yet.
                        </td>
                      </tr>
                    ) : null}
                    {allPeopleRows.map((item) => (
                      <AllPeopleRow
                        key={item.id}
                        item={item}
                        isEditing={editingId === item.id}
                        onAddToLineup={() => addToLineup(item.id)}
                        onCancelEdit={() => setEditingId(null)}
                        onEdit={() => setEditingId(item.id)}
                        onHide={() => hide(item.id)}
                        onMoveToPool={() => removeFromLineup(item.id)}
                        onRestore={() => restore(item.id)}
                        onSaveEdit={(values) => saveEdit(item.id, values)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="lineup-toolbar">
                  <div>
                    <h2 style={{ margin: 0 }}>Lineup</h2>
                    <p className="muted" style={{ margin: "4px 0 0" }}>
                      Drag rows to set the live running order.
                    </p>
                  </div>
                  <label className="target-field">
                    <span>{lineupCount} /</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      defaultValue={lineupTarget ?? ""}
                      placeholder="e.g. 8"
                      onBlur={(event) => commitTarget(event.currentTarget.value)}
                    />
                  </label>
                </div>

                {isAdding ? (
                  <div className="admin-inline-form">
                    <p className="queue-title">Add a person to the lineup</p>
                    <SubmissionForm
                      submitLabel="Add to lineup"
                      onSave={saveNew}
                      onCancel={() => setIsAdding(false)}
                    />
                  </div>
                ) : null}

                <div className="admin-table-wrap">
                  <table className="admin-table admin-lineup-table">
                    <thead>
                      <tr>
                        <th aria-label="Drag handle" />
                        <th>Position</th>
                        <th>Person</th>
                        <th>Demo</th>
                        <th>Category</th>
                        <th>Contact</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <SortableContext items={board.lineup} strategy={verticalListSortingStrategy}>
                      <DroppableTableBody id="lineup" emptyMessage="Use All people to add someone to the lineup.">
                        {board.lineup.map((id, index) => {
                          const item = itemsById.get(id);
                          if (!item) return null;
                          return (
                            <LineupRow
                              key={id}
                              item={item}
                              positionLabel={lineupPositionLabel(index)}
                              statusTone={index <= 1 ? "green" : "blue"}
                              isEditing={editingId === id}
                              onCancelEdit={() => setEditingId(null)}
                              onEdit={() => setEditingId(id)}
                              onHide={() => hide(id)}
                              onMoveToPool={() => removeFromLineup(id)}
                              onSaveEdit={(values) => saveEdit(id, values)}
                            />
                          );
                        })}
                      </DroppableTableBody>
                    </SortableContext>
                  </table>
                </div>
              </>
            )}
          </section>

          <DragOverlay>
            {activeItem ? (
              <article className="queue-item is-overlay">
                <div className="queue-title">{activeItem.demoTitle}</div>
                <p className="muted" style={{ marginBottom: 0 }}>{activeItem.name}</p>
              </article>
            ) : null}
          </DragOverlay>
        </DndContext>

      </div>
    </main>
  );
}

function StagePreviewPanel({
  eventName,
  isLive,
  slug,
}: {
  eventName: string;
  isLive: boolean;
  slug: string;
}) {
  const url = stagePath(slug);
  const previewUrl = `${url}?preview=admin`;

  return (
    <aside className="panel admin-stage-preview-panel">
      <div className="admin-stage-preview-heading">
        <span className="muted">Stage preview</span>
        <span className={isLive ? "pill green" : "pill yellow"}>{isLive ? "Live" : "Draft"}</span>
      </div>
      <div className="admin-stage-preview-viewport">
        <iframe
          className="admin-stage-preview-frame"
          src={previewUrl}
          tabIndex={-1}
          title={`${eventName} stage preview`}
        />
      </div>
      <a
        className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        Open stage
      </a>
    </aside>
  );
}

function DroppableTableBody({
  id,
  children,
  emptyMessage,
}: {
  id: ColumnId;
  children: React.ReactNode;
  emptyMessage: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const hasChildren = Boolean(React.Children.toArray(children).filter(Boolean).length);
  return (
    <tbody ref={setNodeRef} className={`admin-table-body droppable ${isOver ? "is-over" : ""}`}>
      {hasChildren ? children : (
        <tr>
          <td className="admin-empty-cell" colSpan={7}>
            {emptyMessage}
          </td>
        </tr>
      )}
    </tbody>
  );
}

function LineupRow({
  item,
  positionLabel,
  statusTone,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onHide,
  onMoveToPool,
}: {
  item: AdminSubmission;
  positionLabel: string;
  statusTone: StatusTone;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (values: SubmissionFields) => Promise<void> | void;
  onHide: () => void;
  onMoveToPool: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: isEditing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isEditing) {
    return (
      <tr ref={setNodeRef} style={style} className="admin-table-edit-row">
        <td colSpan={7}>
          <SubmissionForm
            initial={item}
            submitLabel="Save changes"
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr ref={setNodeRef} style={style} className={isDragging ? "is-dragging" : ""}>
      <td className="admin-col-handle">
        <button
          className="drag-handle"
          type="button"
          aria-label={`Reorder ${item.demoTitle}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden />
        </button>
      </td>
      <td>
        <span className={`pill ${statusTone === "green" ? "green" : ""}`}>{positionLabel}</span>
      </td>
      <td>
        <PersonCell item={item} />
      </td>
      <td className="admin-demo-cell">
        <DemoCell item={item} />
      </td>
      <td>
        <CategoryCell category={item.category} />
      </td>
      <td>
        <Contact item={item} />
      </td>
      <td>
        <RowActions
          menuLabel={`More actions for ${item.name}`}
          menuItems={[
            { label: "Move to all", onSelect: onMoveToPool },
            { label: "Edit", onSelect: onEdit },
            { label: "Hide", onSelect: onHide },
          ]}
        />
      </td>
    </tr>
  );
}

function AllPeopleRow({
  item,
  isEditing,
  onAddToLineup,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onHide,
  onMoveToPool,
  onRestore,
}: {
  item: RosterRow;
  isEditing: boolean;
  onAddToLineup: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (values: SubmissionFields) => Promise<void> | void;
  onHide: () => void;
  onMoveToPool: () => void;
  onRestore: () => void;
}) {
  if (isEditing) {
    return (
      <tr className="admin-table-edit-row">
        <td colSpan={6}>
          <SubmissionForm
            initial={item}
            submitLabel="Save changes"
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <span className={`pill ${item.statusTone === "green" ? "green" : item.statusTone === "yellow" ? "yellow" : ""}`}>
          {item.statusLabel}
        </span>
      </td>
      <td>
        <PersonCell item={item} />
      </td>
      <td className="admin-demo-cell">
        <DemoCell item={item} />
      </td>
      <td>
        <CategoryCell category={item.category} />
      </td>
      <td>
        <Contact item={item} />
      </td>
      <td>
        <RowActions
          menuLabel={`More actions for ${item.name}`}
          menuItems={
            item.rosterStatus === "inactive"
              ? [
                  { label: "Move to all", onSelect: onRestore },
                  { label: "Edit", onSelect: onEdit },
                  { label: "Hide", onSelect: onHide },
                ]
              : [
                  item.rosterStatus === "pool"
                    ? { label: "Add to lineup", onSelect: onAddToLineup }
                    : item.rosterStatus === "lineup"
                      ? { label: "Move to all", onSelect: onMoveToPool }
                      : { label: "Restore", onSelect: onRestore },
                  { label: "Edit", onSelect: onEdit },
                  { label: "Hide", onSelect: onHide },
                ]
          }
        />
      </td>
    </tr>
  );
}

function PersonCell({ item }: { item: AdminSubmission }) {
  return (
    <div className="admin-person-cell">
      <span>{item.name}</span>
    </div>
  );
}

function DemoCell({ item }: { item: AdminSubmission }) {
  return (
    <>
      <span className="admin-demo-title">{item.demoTitle}</span>
      {item.description ? <span className="muted">{item.description}</span> : null}
    </>
  );
}

function CategoryCell({ category }: { category?: string }) {
  const fullCategory = category || "demo";
  return (
    <span className="admin-category-text" aria-label={fullCategory} title={fullCategory}>
      {fullCategory}
    </span>
  );
}

function RowActions({
  menuLabel,
  menuItems,
}: {
  menuLabel: string;
  menuItems: { label: string; onSelect: () => void }[];
}) {
  return (
    <div className="table-actions">
      {menuItems.length > 0 ? (
        <details className="table-row-menu">
          <summary aria-label={menuLabel}>
            <MoreHorizontal size={16} aria-hidden />
          </summary>
          <div className="table-row-menu-content">
            {menuItems.map((action) => (
              <button key={action.label} onClick={action.onSelect} type="button">
                {action.label}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function buildRosterRows(
  admin: { hidden: AdminSubmission[]; inactive: AdminSubmission[] },
  board: { lineup: Id<"submissions">[]; pool: Id<"submissions">[] },
  itemsById: Map<Id<"submissions">, AdminSubmission>,
): RosterRow[] {
  const lineupRows = board.lineup.flatMap((id, index): RosterRow[] => {
    const item = itemsById.get(id);
    if (!item) return [];
    const positionLabel = lineupPositionLabel(index);
    return [
      {
        ...item,
        positionLabel,
        rosterStatus: "lineup",
        statusLabel: positionLabel,
        statusTone: index <= 1 ? "green" : "blue",
      },
    ];
  });

  const poolRows = board.pool
    .map((id) => itemsById.get(id))
    .filter((item): item is AdminSubmission => Boolean(item))
    .map((item) => ({
      ...item,
      rosterStatus: "pool" as const,
      statusLabel: "Waiting",
      statusTone: "blue" as const,
    }));

  const hiddenRows = admin.hidden.map((item) => ({
    ...item,
    rosterStatus: "hidden" as const,
    statusLabel: "Hidden",
    statusTone: "yellow" as const,
  }));

  const inactiveRows = admin.inactive.map((item) => ({
    ...item,
    rosterStatus: "inactive" as const,
    statusLabel: inactiveStatusLabel(item.status),
    statusTone: "yellow" as const,
  }));

  const seen = new Set<Id<"submissions">>();
  return [...lineupRows, ...poolRows, ...hiddenRows, ...inactiveRows].filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function uniqueSubmissionIds(ids: Id<"submissions">[]) {
  const seen = new Set<Id<"submissions">>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function lineupPositionLabel(index: number) {
  if (index === 0) return "Now demoing";
  if (index === 1) return "Up next";
  return `#${index + 1}`;
}

function inactiveStatusLabel(status: string) {
  if (status === "done") return "Presented";
  if (status === "no_show") return "No-show";
  if (status === "withdrawn") return "Withdrawn";
  return status;
}

function SubmissionForm({
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial?: Partial<SubmissionFields>;
  submitLabel: string;
  onSave: (values: SubmissionFields) => Promise<void> | void;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const values = {
      name: read("name"),
      demoTitle: read("demoTitle"),
      description: read("description"),
      phone: read("phone"),
      email: read("email"),
      twitter: read("twitter"),
      linkedin: read("linkedin"),
      category: read("category"),
    };
    const lengthError = firstFieldLimitError(values);

    if (lengthError) {
      setError(lengthError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={`${fieldId}-name`}>Presenter name</label>
        <input
          id={`${fieldId}-name`}
          name="name"
          defaultValue={initial?.name ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.name}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-demoTitle`}>Demo title</label>
        <input
          id={`${fieldId}-demoTitle`}
          name="demoTitle"
          defaultValue={initial?.demoTitle ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.demoTitle}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-description`}>Short description</label>
        <textarea
          id={`${fieldId}-description`}
          name="description"
          defaultValue={initial?.description ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.description}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-phone`}>Phone number</label>
        <input
          id={`${fieldId}-phone`}
          name="phone"
          defaultValue={initial?.phone ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.phone}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-email`}>Email</label>
        <input
          id={`${fieldId}-email`}
          name="email"
          type="email"
          defaultValue={initial?.email ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.email}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-twitter`}>Twitter/X</label>
        <input
          id={`${fieldId}-twitter`}
          name="twitter"
          defaultValue={initial?.twitter ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.twitter}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-linkedin`}>LinkedIn</label>
        <input
          id={`${fieldId}-linkedin`}
          name="linkedin"
          defaultValue={initial?.linkedin ?? ""}
          maxLength={SUBMISSION_FIELD_LIMITS.linkedin}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-category`}>Category</label>
        <input
          id={`${fieldId}-category`}
          name="category"
          defaultValue={initial?.category ?? ""}
          placeholder="AI, devtools, consumer, hardware..."
          maxLength={SUBMISSION_FIELD_LIMITS.category}
        />
      </div>
      {error ? (
        <p style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600, margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="actions" style={{ marginTop: 4 }}>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving..." : submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Contact({ item }: { item: AdminSubmission }) {
  const hasContact = item.phone || item.email || item.twitter || item.linkedin;
  if (!hasContact) return null;

  return (
    <div className="contact-list">
      <span>{item.phone}</span>
      {item.email ? <a href={`mailto:${item.email}`}>{item.email}</a> : null}
      {item.twitter ? (
        <a href={socialUrl("twitter", item.twitter)} rel="noreferrer" target="_blank">
          {item.twitter}
        </a>
      ) : null}
      {item.linkedin ? (
        <a href={socialUrl("linkedin", item.linkedin)} rel="noreferrer" target="_blank">
          {item.linkedin}
        </a>
      ) : null}
    </div>
  );
}

function socialUrl(kind: "twitter" | "linkedin", value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const clean = value.trim().replace(/^@/, "").replace(/^\/+/, "");
  if (kind === "twitter") return `https://x.com/${clean}`;
  if (clean.startsWith("in/")) return `https://www.linkedin.com/${clean}`;
  return `https://www.linkedin.com/in/${clean}`;
}
