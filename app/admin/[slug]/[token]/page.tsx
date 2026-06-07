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
  const shuffleQueue = useMutation(api.events.shuffleQueue);
  const hideSubmission = useMutation(api.events.hideSubmission);
  const restoreSubmission = useMutation(api.events.restoreSubmission);
  const pickNext = useMutation(api.events.pickNext);
  const adminAddSubmission = useMutation(api.events.adminAddSubmission);
  const updateSubmission = useMutation(api.events.updateSubmission);
  const [draggedId, setDraggedId] = useState<Id<"submissions"> | null>(null);
  const [editingId, setEditingId] = useState<Id<"submissions"> | null>(null);
  const [isAdding, setIsAdding] = useState(false);

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

  async function moveDragged(beforeId: Id<"submissions">) {
    if (!draggedId || draggedId === beforeId) {
      return;
    }

    const remaining = queue.filter((item) => item.id !== draggedId);
    const dragged = queue.find((item) => item.id === draggedId);
    if (!dragged) {
      return;
    }

    const beforeIndex = remaining.findIndex((item) => item.id === beforeId);
    const reordered = [...remaining];
    reordered.splice(beforeIndex, 0, dragged);

    await shuffleQueue({
      slug: params.slug,
      adminToken: params.token,
      orderedIds: reordered.map((item) => item.id),
    });
    setDraggedId(null);
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
    const batchId = Date.now().toString().slice(-5);

    await Promise.all(
      Array.from({ length: safeCount }, async (_, index) => {
        const number = index + 1;

        await adminAddSubmission({
          slug: params.slug,
          adminToken: params.token,
          participantToken: randomToken(32),
          name: `Test Person ${batchId}-${number}`,
          demoTitle: `Test Demo ${batchId}-${number}`,
          description: `Temporary seeded demo ${number} for queue testing.`,
          phone: `+155501${String(number).padStart(4, "0")}`,
          email: `test-${batchId}-${number}@example.com`,
          category: ["AI", "Devtools", "Consumer", "Hardware"][index % 4],
          queueOrder: randomQueueOrder(),
        });
      }),
    );
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

            <div className="queue-list">
              {queue.map((item: AdminSubmission, index: number) => {
                const isEditing = editingId === item.id;

                return (
                  <article
                    className={`queue-item ${draggedId === item.id ? "dragging" : ""}`}
                    draggable={!isEditing}
                    key={item.id}
                    onDragStart={() => {
                      if (!isEditing) setDraggedId(item.id);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!isEditing) moveDragged(item.id);
                    }}
                  >
                    {isEditing ? (
                      <SubmissionForm
                        initial={item}
                        submitLabel="Save changes"
                        onSave={(values) => saveEdit(item.id, values)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <>
                        <div className="queue-row">
                          <div>
                            <span className="pill">#{index + 1}</span>
                            <div className="queue-title" style={{ marginTop: 8 }}>
                              {item.demoTitle}
                            </div>
                            <p className="muted" style={{ marginBottom: 0 }}>{item.name}</p>
                          </div>
                          <span className="pill green">{item.category || "demo"}</span>
                        </div>

                        <p className="muted" style={{ marginBottom: 0 }}>{item.description}</p>
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
                            variant="ghost"
                            size="sm"
                            onClick={() => hide(item.id)}
                            type="button"
                          >
                            Hide
                          </Button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>

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
