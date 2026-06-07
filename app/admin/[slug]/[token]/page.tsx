"use client";

import { FormEvent, useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { absoluteUrl, stagePath, submissionPath } from "@/lib/routes";
import { randomQueueOrder, randomToken, shuffled } from "@/lib/tokens";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { makeSamplePerson } from "@/lib/sampleData";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

export default function AdminPage() {
  const params = useParams<{ slug: string; token: string }>();
  const admin = useQuery(api.events.getAdmin, {
    slug: params.slug,
    adminToken: params.token,
  });
  const publishQueue = useMutation(api.events.publishQueue);
  const shuffleQueue = useMutation(api.events.shuffleQueue).withOptimisticUpdate(
    (localStore, args) => {
      const queryArgs = { slug: args.slug, adminToken: args.adminToken };
      const current = localStore.getQuery(api.events.getAdmin, queryArgs);
      if (!current) {
        return;
      }

      const byId = new Map(current.queue.map((entry) => [entry.id, entry]));
      const reordered = args.orderedIds
        .map((id) => byId.get(id))
        .filter((entry): entry is (typeof current.queue)[number] => Boolean(entry));

      localStore.setQuery(api.events.getAdmin, queryArgs, { ...current, queue: reordered });
    },
  );
  const hideSubmission = useMutation(api.events.hideSubmission);
  const restoreSubmission = useMutation(api.events.restoreSubmission);
  const pickNext = useMutation(api.events.pickNext);
  const clearQueue = useMutation(api.events.clearQueue);
  const adminAddSubmission = useMutation(api.events.adminAddSubmission);
  const updateSubmission = useMutation(api.events.updateSubmission);
  const [editingId, setEditingId] = useState<Id<"submissions"> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const queue = useMemo(() => admin?.queue ?? [], [admin?.queue]);

  if (!admin) {
    return (
      <main className="narrow-page">
        <section className="panel panel-pad">Loading admin queue...</section>
      </main>
    );
  }

  const queueIsLive = admin.event.queuePublished;

  async function publish() {
    await publishQueue({ slug: params.slug, adminToken: params.token });
  }

  async function shuffle() {
    if (queueIsLive) {
      return;
    }

    const orderedIds = shuffled(queue).map((item) => item.id);
    await shuffleQueue({ slug: params.slug, adminToken: params.token, orderedIds });
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const ids = queue.map((item) => item.id);
    const oldIndex = ids.indexOf(active.id as Id<"submissions">);
    const newIndex = ids.indexOf(over.id as Id<"submissions">);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const orderedIds = arrayMove(ids, oldIndex, newIndex);
    await shuffleQueue({ slug: params.slug, adminToken: params.token, orderedIds });
  }

  async function hide(id: Id<"submissions">) {
    await hideSubmission({ slug: params.slug, adminToken: params.token, submissionId: id });
  }

  async function restore(id: Id<"submissions">) {
    await restoreSubmission({
      slug: params.slug,
      adminToken: params.token,
      submissionId: id,
      queueOrder: randomQueueOrder(),
    });
  }

  async function next() {
    if (!queueIsLive) {
      return;
    }

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
      queueOrder: randomQueueOrder(),
    });
    setIsAdding(false);
  }

  async function addTestPeople() {
    const countInput = window.prompt("How many test people should I add?", "8");
    const count = Number.parseInt(countInput ?? "", 10);

    if (!Number.isFinite(count) || count <= 0) {
      return;
    }

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
          queueOrder: randomQueueOrder(),
        });
      }),
    );
  }

  async function clearAll() {
    const confirmed = window.confirm(
      "Delete ALL submissions for this event? This permanently removes everyone from the queue and resets the event to its blank, pre-publish state. This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

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

  return (
    <main className="page">
      <div className="shell">
        <p className="eyebrow">Admin</p>
        <h1>{admin.event.name}</h1>

        <div className="status-strip">
          <span className={queueIsLive ? "pill green" : "pill yellow"}>
            {queueIsLive ? "Queue is live" : "Not live yet"}
          </span>
          <span className="pill">{queue.length} queued</span>
          <span className="pill">{admin.hidden.length} hidden</span>
        </div>

        <section className="admin-grid">
          <div className="panel panel-pad">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0 }}>Live order</h2>
              <div className="actions" style={{ marginTop: 0 }}>
                {queueIsLive ? (
                  <Button onClick={next} type="button">
                    Advance to next demo
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={shuffle} type="button">
                      Shuffle draft
                    </Button>
                    <Button onClick={publish} type="button">
                      Make queue live
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="grid-two" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 18 }}>
              <SpeakerCard label="Current" item={admin.current} />
              <SpeakerCard label="Up next" item={admin.upNext} />
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={queue.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="queue-list">
                  {queue.length === 0 ? (
                    <p className="muted">No one in the queue yet.</p>
                  ) : null}
                  {queue.map((item: AdminSubmission, index: number) => (
                    <SortableQueueRow
                      key={item.id}
                      item={item}
                      index={index}
                      isEditing={editingId === item.id}
                      onEdit={() => setEditingId(item.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(values) => saveEdit(item.id, values)}
                      onHide={() => hide(item.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {isAdding ? (
              <article className="queue-item" style={{ marginTop: 14 }}>
                <p className="queue-title">Add a person</p>
                <SubmissionForm
                  submitLabel="Add to queue"
                  onSave={saveNew}
                  onCancel={() => setIsAdding(false)}
                />
              </article>
            ) : (
              <div className="actions" style={{ marginTop: 14 }}>
                <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} type="button">
                  Add person
                </Button>
                <Button variant="ghost" size="sm" onClick={addTestPeople} type="button">
                  Add test people
                </Button>
                {queueIsLive || queue.length > 0 || admin.hidden.length > 0 || admin.inactive.length > 0 ? (
                  <Button variant="destructive" size="sm" onClick={clearAll} type="button">
                    Clear all
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          <aside style={{ display: "grid", gap: 18 }}>
            <section className="panel panel-pad">
              <h2>Submission QR</h2>
              <div className="qr-box">
                <QRCodeSVG value={absoluteUrl(submissionPath(params.slug))} size={260} marginSize={2} />
              </div>
              <div className="copy-line" style={{ marginTop: 12 }}>
                {absoluteUrl(submissionPath(params.slug))}
              </div>
              <a
                className={cn(buttonVariants({ variant: "outline" }), "mt-3 w-full")}
                href={stagePath(params.slug)}
                target="_blank"
              >
                Open stage
              </a>
            </section>

            <section className="panel panel-pad">
              <h2>Meet link</h2>
              <div className="copy-line">{admin.event.meetUrl}</div>
              <p className="muted" style={{ marginTop: 12 }}>
                This is visible to admin and to participants only when they are up next or current.
              </p>
            </section>

            <section className="panel panel-pad">
              <h2>Hidden</h2>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(item.id)}
                          type="button"
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => restore(item.id)}
                          type="button"
                        >
                          Restore to queue
                        </Button>
                      </div>
                    </article>
                  ),
                )}
                {admin.hidden.length === 0 ? <p className="muted">No hidden submissions.</p> : null}
              </div>
            </section>

            <section className="panel panel-pad">
              <h2>Inactive</h2>
              <div className="queue-list">
                {admin.inactive.map((item: AdminSubmission) => (
                  <article className="queue-item" key={item.id}>
                    <div className="queue-title">{item.demoTitle}</div>
                    <span className="pill yellow">{item.status}</span>
                  </article>
                ))}
                {admin.inactive.length === 0 ? <p className="muted">Nothing inactive yet.</p> : null}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function SpeakerCard({ label, item }: { label: string; item: AdminSubmission | null }) {
  return (
    <section className="queue-item">
      <span className="pill green">{label}</span>
      <h3>{item?.demoTitle ?? "Not set"}</h3>
      <p className="muted" style={{ marginBottom: 0 }}>
        {item?.name ?? "Make the queue live, then advance."}
      </p>
    </section>
  );
}

function SortableQueueRow({
  item,
  index,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onHide,
}: {
  item: AdminSubmission;
  index: number;
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
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
    position: "relative" as const,
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
                <span aria-hidden>⠿</span>
              </button>
              <div>
                <span className="pill">#{index + 1}</span>
                <div className="queue-title" style={{ marginTop: 8 }}>
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
        <input
          id={`${fieldId}-email`}
          name="email"
          type="email"
          defaultValue={initial?.email ?? ""}
        />
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
