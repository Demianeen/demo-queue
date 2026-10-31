"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { EventWelcome } from "./EventWelcome";
import { StagePresentationPreview } from "./StagePresentationPreview";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import { VISUAL_STYLES, VISUAL_STYLE_LABELS, type VisualStyle } from "@/lib/visual-style";
import { submissionPath } from "@/lib/routes";
import { useSiteOrigin } from "@/lib/use-site-origin";

/** The colours each preset's card shows, taken from its stage. */
const PRESET_SWATCHES: Record<VisualStyle, { background: string; foreground: string }> = {
  neutral: { background: "#ffffff", foreground: "#1f1f23" },
  codex: { background: "#0d0d0d", foreground: "#ffffff" },
  outpost: { background: "#111113", foreground: "#ffffff" },
  astra: { background: "#0b1026", foreground: "#e7e9ff" },
  devday: { background: "#f7f2e8", foreground: "#1f1f23" },
};

type Card = { id: string; name: string; background: string; foreground: string; isDefault: boolean; preset?: VisualStyle; saved?: Doc<"organizationStyles"> };

export function OrganizationStyles({ organizationId, organizationName, styles }: {
  organizationId: string; organizationName: string; styles: Doc<"organizationStyles">[];
}) {
  const origin = useSiteOrigin();
  const defaultStyle = styles.find((style) => style.isDefault);
  const defaultId = defaultStyle ? defaultStyle.preset ? `preset:${defaultStyle.preset}` : defaultStyle._id : "preset:neutral";
  const [selected, setSelected] = useState<string>(defaultId);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const setPresetDefault = useMutation(api.organizationStyles.setPresetDefault);
  const setSavedDefault = useMutation(api.organizationStyles.setSavedDefault);
  const cards: Card[] = [
    ...VISUAL_STYLES.map((preset) => ({ id: `preset:${preset}`, name: VISUAL_STYLE_LABELS[preset], ...PRESET_SWATCHES[preset], isDefault: `preset:${preset}` === defaultId, preset })),
    ...styles.filter((style) => !style.preset).map((style) => ({ id: style._id, name: style.name, background: style.theme.background, foreground: style.theme.foreground, isDefault: style._id === defaultId, saved: style })),
  ];
  const current = cards.find((card) => card.id === selected);

  function select(id: string) { setSelected(id); setSaved(false); setError(""); }
  async function makeDefault(card: Card) {
    select(card.id);
    setSaving(card.id);
    try {
      if (card.preset) await setPresetDefault({ expectedOrganizationId: organizationId, preset: card.preset });
      else if (card.saved) await setSavedDefault({ expectedOrganizationId: organizationId, id: card.saved._id });
      setSaved(true);
    } catch (error) { setError(error instanceof ConvexError && typeof error.data === "string" ? error.data : "Could not update the default style. Please try again."); }
    finally { setSaving(null); }
  }

  return <section className="ws-page">
    <h1 className="sr-only">Styles</h1>
    <div className="ws-main">
      <div className="flex items-center gap-2"><h2 className="ws-card-title">Available styles</h2><span className="ws-count">{cards.length}</span></div>
      {saved && <p role="status" className="ws-success">Organization default updated. Existing events keep their current appearance.</p>}
      {error && <p role="alert" className="ws-error">{error}</p>}
      <ul className="style-cards" aria-label="Available styles">
        {cards.map((card) => <li key={card.id} className="style-card" data-selected={card.id === selected ? "" : undefined}>
          <button type="button" className="style-card-pick" aria-pressed={card.id === selected} aria-label={`Preview ${card.name}`} disabled={saving !== null} onClick={() => select(card.id)}>
            <span className="style-card-swatch" style={{ background: card.background, color: card.foreground }} aria-hidden>Demo Night</span>
          </button>
          <div className="style-card-meta">
            <span className="style-card-name">{card.name}</span>
            {card.isDefault ? <span className="style-card-default">Organization default</span>
              : <button type="button" className="style-card-use" disabled={saving !== null} onClick={() => void makeDefault(card)}>{saving === card.id ? "Saving…" : "Use as default"}</button>}
          </div>
        </li>)}
      </ul>
    </div>
    <aside className="ws-side">
      <div className="ws-card ws-card-body">
        <div className="flex items-center gap-2"><h2 className="ws-card-title">Event presentation preview</h2><span className="flex-1" /><span className="ws-sub">{current?.name}</span></div>
        {current ? <div className="workspace-preview-frame !mt-0" inert>{!current.preset || current.preset === "neutral"
          ? <EventWelcome name="Demo Night" eventType="demo" submissionUrl={`${origin}${submissionPath("preview")}`} theme={current.saved?.theme} />
          : <StagePresentationPreview stage={buildStagePreviewFixture({ eventName: "Demo Night", eventType: "demo", visualStyle: current.preset, meetUrl: "" })} submissionUrl={`${origin}${submissionPath("preview")}`} />}</div>
          : <p className="ws-sub">This style is no longer available. Choose another style above.</p>}
        <p className="ws-help">New events in {organizationName} start in the organization default. Each event can pick its own style in New event; existing events keep their current appearance.</p>
      </div>
    </aside>
  </section>;
}
