"use client";

import { useRef } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MAX_EVENT_SPONSORS, MAX_SPONSOR_NAME_LENGTH, MAX_SPONSOR_USAGE_LENGTH, SPONSOR_USAGE_PLACEHOLDER } from "@/lib/sponsors";

export type DraftSponsor = { key: number; name: string; usage: string };

/** Sponsor rows on the create event form, below Tracks. Blank rows are dropped on submit. */
export function EventSponsorsFields({ sponsors, onChange }: { sponsors: DraftSponsor[]; onChange: (next: DraftSponsor[]) => void }) {
  const nextKey = useRef(sponsors.reduce((max, sponsor) => Math.max(max, sponsor.key), 0) + 1);
  const update = (key: number, patch: Partial<DraftSponsor>) => onChange(sponsors.map((sponsor) => (sponsor.key === key ? { ...sponsor, ...patch } : sponsor)));

  return (
    <fieldset className="new-event-field workspace-tracks" aria-describedby="sponsors-help">
      <legend className="workspace-label">Sponsors <span className="new-event-optional">optional</span></legend>
      {sponsors.map((sponsor, index) => (
        <div className="workspace-track-row" key={sponsor.key}>
          <div className="workspace-track-inputs">
            <Input aria-label={`Sponsor ${index + 1} name`} className="new-event-input" data-size="track" maxLength={MAX_SPONSOR_NAME_LENGTH}
              onChange={(event) => update(sponsor.key, { name: event.target.value })} placeholder="Sponsor name" value={sponsor.name} />
            <Input aria-label={`What counts as using sponsor ${index + 1}`} className="new-event-input workspace-track-description" data-size="name" maxLength={MAX_SPONSOR_USAGE_LENGTH}
              onChange={(event) => update(sponsor.key, { usage: event.target.value })} placeholder={SPONSOR_USAGE_PLACEHOLDER} value={sponsor.usage} />
          </div>
          <div className="workspace-track-actions">
            <Button aria-label={`Remove sponsor ${sponsor.name || index + 1}`} onClick={() => onChange(sponsors.filter((candidate) => candidate.key !== sponsor.key))} size="icon-sm" type="button" variant="ghost">
              <X aria-hidden size={16} />
            </Button>
          </div>
        </div>
      ))}
      {sponsors.length < MAX_EVENT_SPONSORS ? (
        <div>
          <Button className="workspace-track-add" onClick={() => onChange([...sponsors, { key: nextKey.current++, name: "", usage: "" }])} type="button" variant="outline" size="sm">
            <Plus aria-hidden size={16} /> Add sponsor
          </Button>
        </div>
      ) : null}
      <p id="sponsors-help" className="new-event-help">
        The AI summary checks each project for these and gives a level, Core, Used, Light or No sign, with its evidence. You can change them later in Settings.
      </p>
    </fieldset>
  );
}
