"use client";

import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { absoluteUrl, stagePath, submissionPath } from "@/lib/routes";
import { randomToken } from "@/lib/tokens";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { makeSamplePerson } from "@/lib/sampleData";
import { Skeleton } from "@/app/Skeleton";
import { Brand } from "@/app/Brand";
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
import { GripVertical } from "lucide-react";

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
  const clearQueue = useMutation(api.events.clearQueue);
  const adminAddSubmission = useMutation(api.events.adminAddSubmission);
  const updateSubmission = useMutation(api.events.updateSubmission);
  const setLineupTarget = useMutation(api.events.setLineupTarget);
  const shuffleLineup = useMutation(api.events.shuffleLineup);

  const reorderLineup = useMutation(api.events.reorderLineup).withOptimisticUpdate(
    (store, args) => {
      const qa = { slug: args.slug, adminToken: args.adminToken };
      const cur = store.getQuery(api.events.getAdmin, qa);
      if (!cur) return;
      const byId = new Map(
        [...cur.lineup, ...cur.pool, ...cur.hidden].map((e) => [e.id, e] as const),
      );
      const ordered = new Set(args.orderedIds);
      const newLineup = args.orderedIds
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
  const [activeId, setActiveId] = useState<Id<"submissions"> | null>(null);
  const [board, setBoard] = useState<{ lineup: Id<"submissions">[]; pool: Id<"submissions">[] }>({
    lineup: [],
    pool: [],
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemsById = useMemo(() => {
    const map = new Map<Id<"submissions">, AdminSubmission>();
    admin?.lineup.forEach((item) => map.set(item.id, item));
    admin?.pool.forEach((item) => map.set(item.id, item));
    return map;
  }, [admin?.lineup, admin?.pool]);

  // Mirror the server lists into local board state for drag previews, but never
  // while a drag is in flight (that would yank a card out from under the cursor).
  useEffect(() => {
    if (activeId || !admin) return;
    setBoard({
      lineup: admin.lineup.map((item) => item.id),
      pool: admin.pool.map((item) => item.id),
    });
  }, [admin, activeId]);

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

  async function hide(id: Id<"submissions">) {
    await hideSubmission({ slug: params.slug, adminToken: params.token, submissionId: id });
  }

  async function restore(id: Id<"submissions">) {
    await restoreSubmission({ slug: params.slug, adminToken: params.token, submissionId: id });
  }

  async function next() {
    if (!queueIsLive) return;
    await pickNext({ slug: params.slug, adminToken: params.token });
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
    const countInput = window.prompt("How many test people should I add to the pool?", "8");
    const count = Number.parseInt(countInput ?? "", 10);
    if (!Number.isFinite(count) || count <= 0) return;

    const safeCount = Math.min(count, 30);
    await Promise.all(
      Array.from({ length: safeCount }, async () => {
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
              <span className="pill">{admin.hidden.length} hidden</span>
            </div>

            <div className="actions" style={{ marginBottom: 14 }}>
              {queueIsLive ? (
                <Button onClick={next} type="button">
                  Advance to next demo
                </Button>
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
              <Button variant="outline" onClick={() => setIsAdding(true)} type="button">
                Add person
              </Button>
              <Button variant="ghost" onClick={addTestPeople} type="button">
                Add test people
              </Button>
              {lineupCount > 0 || board.pool.length > 0 || admin.hidden.length > 0 ? (
                <Button variant="destructive" onClick={clearAll} type="button">
                  Clear all
                </Button>
              ) : null}
            </div>

            <div className="field" style={{ maxWidth: 480 }}>
              <label htmlFor="meetUrl">Meet link</label>
              <input id="meetUrl" readOnly value={admin.event.meetUrl} />
              <span className="muted" style={{ fontSize: 12 }}>
                Visible to admin; participants see it only when up next or current.
              </span>
            </div>
          </div>

          <aside
            className="panel panel-pad"
            style={{ flex: "0 0 auto", width: 230, textAlign: "center" }}
          >
            <span
              className="muted"
              style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}
            >
              Scan to submit
            </span>
            <div className="qr-box" style={{ marginTop: 8, padding: 10 }}>
              <QRCodeSVG
                value={absoluteUrl(submissionPath(params.slug))}
                size={180}
                marginSize={2}
              />
            </div>
            <a
              className={cn(buttonVariants({ variant: "outline" }), "mt-3 w-full")}
              href={stagePath(params.slug)}
              target="_blank"
            >
              Open stage
            </a>
          </aside>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <section className="admin-grid">
            <div className="panel panel-pad">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <h2 style={{ margin: 0 }}>Lineup</h2>
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
                <article className="queue-item" style={{ marginBottom: 12 }}>
                  <p className="queue-title">Add a person to the lineup</p>
                  <SubmissionForm
                    submitLabel="Add to lineup"
                    onSave={saveNew}
                    onCancel={() => setIsAdding(false)}
                  />
                </article>
              ) : null}

              <SortableContext items={board.lineup} strategy={verticalListSortingStrategy}>
                <DroppableList id="lineup">
                  {board.lineup.length === 0 ? (
                    <p className="muted drop-hint">Drag people here from All people.</p>
                  ) : null}
                  {board.lineup.map((id, index) => {
                    const item = itemsById.get(id);
                    if (!item) return null;
                    return (
                      <PersonCard
                        key={id}
                        item={item}
                        topLabel={index === 0 ? "Now demoing" : index === 1 ? "Up next" : `#${index + 1}`}
                        topLabelTone={index <= 1 ? "green" : "blue"}
                        isEditing={editingId === id}
                        onEdit={() => setEditingId(id)}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={(values) => saveEdit(id, values)}
                        onHide={() => hide(id)}
                      />
                    );
                  })}
                </DroppableList>
              </SortableContext>
            </div>

            <div className="panel panel-pad">
              <h2 style={{ marginBottom: 14 }}>All people</h2>

              <SortableContext items={board.pool} strategy={verticalListSortingStrategy}>
                <DroppableList id="pool">
                  {board.pool.length === 0 ? (
                    <p className="muted drop-hint">
                      Everyone who submits lands here. Drag them into the lineup.
                    </p>
                  ) : null}
                  {board.pool.map((id) => {
                    const item = itemsById.get(id);
                    if (!item) return null;
                    return (
                      <PersonCard
                        key={id}
                        item={item}
                        isEditing={editingId === id}
                        onEdit={() => setEditingId(id)}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={(values) => saveEdit(id, values)}
                        onHide={() => hide(id)}
                      />
                    );
                  })}
                </DroppableList>
              </SortableContext>

              {admin.hidden.length > 0 ? (
                <div style={{ marginTop: 18 }}>
                  <h3 style={{ marginBottom: 10 }}>Hidden</h3>
                  <div className="queue-list">
                    {admin.hidden.map((item: AdminSubmission) =>
                      editingId === item.id ? (
                        <article className="queue-item" key={item.id}>
                          <SubmissionForm
                            initial={item}
                            submitLabel="Save changes"
                            onSave={(values) => saveEdit(item.id, values)}
                            onCancel={() => setEditingId(null)}
                          />
                        </article>
                      ) : (
                        <article className="queue-item" key={item.id}>
                          <div className="queue-title">{item.demoTitle}</div>
                          <p className="muted" style={{ marginBottom: 0 }}>{item.name}</p>
                          <Contact item={item} />
                          <div className="actions" style={{ marginTop: 0 }}>
                            <Button variant="ghost" size="sm" onClick={() => setEditingId(item.id)} type="button">
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => restore(item.id)} type="button">
                              Restore to pool
                            </Button>
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                </div>
              ) : null}
            </div>
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

        {admin.inactive.length > 0 ? (
          <section className="panel panel-pad" style={{ marginTop: 18 }}>
            <h2>Done / inactive</h2>
            <div className="queue-list">
              {admin.inactive.map((item: AdminSubmission) => (
                <article className="queue-item" key={item.id}>
                  <div className="queue-title">{item.demoTitle}</div>
                  <span className="pill yellow">{item.status}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function DroppableList({ id, children }: { id: ColumnId; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`queue-list droppable ${isOver ? "is-over" : ""}`}>
      {children}
    </div>
  );
}

function PersonCard({
  item,
  topLabel,
  topLabelTone = "blue",
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onHide,
}: {
  item: AdminSubmission;
  topLabel?: string;
  topLabelTone?: "green" | "blue";
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (values: SubmissionFields) => Promise<void> | void;
  onHide: () => void;
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

  return (
    <article ref={setNodeRef} style={style} className="queue-item">
      {isEditing ? (
        <SubmissionForm
          initial={item}
          submitLabel="Save changes"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <>
          <div className="queue-row">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <button
                className="drag-handle"
                type="button"
                aria-label={`Reorder ${item.demoTitle}`}
                {...attributes}
                {...listeners}
              >
                <GripVertical size={16} aria-hidden />
              </button>
              <div>
                {topLabel ? (
                  <span className={`pill ${topLabelTone === "green" ? "green" : ""}`}>{topLabel}</span>
                ) : null}
                <div className="queue-title" style={{ marginTop: topLabel ? 8 : 0 }}>
                  {item.demoTitle}
                </div>
                <p className="muted" style={{ marginBottom: 0 }}>{item.name}</p>
              </div>
            </div>
            <span className="pill green">{item.category || "demo"}</span>
          </div>

          <p className="muted" style={{ marginBottom: 0 }}>{item.description}</p>
          <Contact item={item} />
          <div className="actions" style={{ marginTop: 0 }}>
            <Button variant="ghost" size="sm" onClick={onEdit} type="button">
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onHide} type="button">
              Hide
            </Button>
          </div>
        </>
      )}
    </article>
  );
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();

    setSaving(true);
    try {
      await onSave({
        name: read("name"),
        demoTitle: read("demoTitle"),
        description: read("description"),
        phone: read("phone"),
        email: read("email"),
        twitter: read("twitter"),
        linkedin: read("linkedin"),
        category: read("category"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={`${fieldId}-name`}>Presenter name</label>
        <input id={`${fieldId}-name`} name="name" defaultValue={initial?.name ?? ""} required />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-demoTitle`}>Demo title</label>
        <input
          id={`${fieldId}-demoTitle`}
          name="demoTitle"
          defaultValue={initial?.demoTitle ?? ""}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-description`}>Short description</label>
        <textarea
          id={`${fieldId}-description`}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-phone`}>Phone number</label>
        <input id={`${fieldId}-phone`} name="phone" defaultValue={initial?.phone ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-email`}>Email</label>
        <input id={`${fieldId}-email`} name="email" type="email" defaultValue={initial?.email ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-twitter`}>Twitter/X</label>
        <input id={`${fieldId}-twitter`} name="twitter" defaultValue={initial?.twitter ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-linkedin`}>LinkedIn</label>
        <input id={`${fieldId}-linkedin`} name="linkedin" defaultValue={initial?.linkedin ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-category`}>Category</label>
        <input
          id={`${fieldId}-category`}
          name="category"
          defaultValue={initial?.category ?? ""}
          placeholder="AI, devtools, consumer, hardware..."
        />
      </div>
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
  return (
    <div className="contact-list">
      <span>{item.phone}</span>
      {item.email ? <span>{item.email}</span> : null}
      {item.twitter ? <span>{item.twitter}</span> : null}
      {item.linkedin ? <span>{item.linkedin}</span> : null}
    </div>
  );
}
