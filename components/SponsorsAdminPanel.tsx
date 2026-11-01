"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation } from "convex/react";
import { X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { MAX_EVENT_SPONSORS, MAX_SPONSOR_NAME_LENGTH, MAX_SPONSOR_USAGE_LENGTH, SPONSOR_USAGE_PLACEHOLDER } from "@/lib/sponsors";
import styles from "./TracksAdminPanel.module.css";

export type AdminSponsor = { id: Id<"eventSponsors">; name: string; usage?: string };

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : fallback;
}

/** Enter saves the field, Escape puts back what was saved. */
function fieldKeys(event: KeyboardEvent<HTMLInputElement>, reset: () => void) {
  if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
  else if (event.key === "Escape") { reset(); requestAnimationFrame(() => (event.target as HTMLInputElement).blur()); }
}

/** A hackathon's sponsors in Settings: rows that edit in place, like tracks, without order or counts. */
export function SponsorsAdminPanel({ slug, sponsors }: { slug: string; sponsors: AdminSponsor[] }) {
  const addSponsor = useMutation(api.sponsors.addSponsor);
  const updateSponsor = useMutation(api.sponsors.updateSponsor);
  const removeSponsor = useMutation(api.sponsors.removeSponsor);
  const [newName, setNewName] = useState("");
  const [newUsage, setNewUsage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await run(() => addSponsor({ slug, name, usage: newUsage.trim() || undefined }), "Could not add the sponsor.")) { setNewName(""); setNewUsage(""); }
  }

  return (
    <section aria-labelledby="admin-sponsors-heading" className={styles.panel}>
      <div>
        <h2 id="admin-sponsors-heading" className={styles.title}>Sponsors</h2>
        <p className={styles.note}>Optional. The AI summary checks each project for these. Each project gets a level, Core, Used, Light or No sign, with its evidence.</p>
      </div>
      <div className={styles.list}>
        <ul className={styles.rows}>
          {sponsors.map((sponsor) => <SponsorRow key={sponsor.id} sponsor={sponsor} busy={busy}
            onSave={(name, usage) => run(() => updateSponsor({ slug, sponsorId: sponsor.id, name, usage }), "Could not save the sponsor.")}
            onRemove={() => void run(() => removeSponsor({ slug, sponsorId: sponsor.id }), "Could not remove the sponsor.")} />)}
        </ul>
        {sponsors.length < MAX_EVENT_SPONSORS ? (
          <form className={styles.addRow} data-flush="" onSubmit={add}>
            <input aria-label="New sponsor name" className={styles.nameInput} maxLength={MAX_SPONSOR_NAME_LENGTH} onChange={(event) => setNewName(event.target.value)} placeholder="New sponsor name" value={newName} />
            <input aria-label="What counts as using the new sponsor" className={styles.descriptionInput} maxLength={MAX_SPONSOR_USAGE_LENGTH} onChange={(event) => setNewUsage(event.target.value)} placeholder={SPONSOR_USAGE_PLACEHOLDER} value={newUsage} />
            <Button disabled={busy || !newName.trim()} size="sm" type="submit" variant="outline">Add sponsor</Button>
          </form>
        ) : <p className={styles.note}>An event can have up to {MAX_EVENT_SPONSORS} sponsors.</p>}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}

function SponsorRow({ sponsor, busy, onSave, onRemove }: {
  sponsor: AdminSponsor;
  busy: boolean;
  onSave: (name: string, usage?: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(sponsor.name);
  const [usage, setUsage] = useState(sponsor.usage ?? "");
  useEffect(() => { setName(sponsor.name); }, [sponsor.name]);
  useEffect(() => { setUsage(sponsor.usage ?? ""); }, [sponsor.usage]);

  async function save() {
    const nextName = name.trim();
    const nextUsage = usage.trim();
    if (!nextName) { setName(sponsor.name); return; }
    if (nextName === sponsor.name && nextUsage === (sponsor.usage ?? "")) return;
    if (!(await onSave(nextName, nextUsage || undefined))) { setName(sponsor.name); setUsage(sponsor.usage ?? ""); }
  }

  return (
    <li className={styles.item}>
      <div className={styles.row} data-flush="">
        <input aria-label={`Name for ${sponsor.name}`} className={styles.nameInput} maxLength={MAX_SPONSOR_NAME_LENGTH} value={name}
          onChange={(event) => setName(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => fieldKeys(event, () => setName(sponsor.name))} />
        <input aria-label={`What counts as using ${sponsor.name}`} className={styles.descriptionInput} maxLength={MAX_SPONSOR_USAGE_LENGTH} placeholder={SPONSOR_USAGE_PLACEHOLDER} value={usage}
          onChange={(event) => setUsage(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => fieldKeys(event, () => setUsage(sponsor.usage ?? ""))} />
        <span className="flex-1" />
        <Button aria-label={`Remove ${sponsor.name}`} title="Remove" disabled={busy} onClick={onRemove} size="icon-xs" type="button" variant="ghost">
          <X aria-hidden />
        </Button>
      </div>
    </li>
  );
}
