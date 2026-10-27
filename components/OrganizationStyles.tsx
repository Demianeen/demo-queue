"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EventWelcome } from "./EventWelcome";
import { StagePresentationPreview } from "./StagePresentationPreview";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import { VISUAL_STYLES, VISUAL_STYLE_LABELS } from "@/lib/visual-style";
import { submissionPath } from "@/lib/routes";
import { useSiteOrigin } from "@/lib/use-site-origin";

export function OrganizationStyles({ organizationId, organizationName, styles }: {
  organizationId: string; organizationName: string; styles: Doc<"organizationStyles">[];
}) {
  const origin = useSiteOrigin();
  const defaultStyle = styles.find((style) => style.isDefault);
  const [selected, setSelected] = useState<string>(() => defaultStyle ? defaultStyle.preset ? `preset:${defaultStyle.preset}` : defaultStyle._id : "preset:neutral");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const setPresetDefault = useMutation(api.organizationStyles.setPresetDefault);
  const setSavedDefault = useMutation(api.organizationStyles.setSavedDefault);
  const preset = VISUAL_STYLES.find((style) => selected === `preset:${style}`);
  const savedStyle = styles.find((style) => !style.preset && style._id === selected);
  const isDefault = preset ? defaultStyle ? defaultStyle.preset === preset : preset === "neutral" : defaultStyle?._id === selected;
  function select(id: string) { setSelected(id); setSaved(false); setError(""); }
  async function saveDefault() {
    if (!preset && !savedStyle) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      if (preset) await setPresetDefault({ expectedOrganizationId: organizationId, preset });
      else if (savedStyle) await setSavedDefault({ expectedOrganizationId: organizationId, id: savedStyle._id });
      setSaved(true);
    } catch (error) { setError(error instanceof ConvexError && typeof error.data === "string" ? error.data : "Could not update the default style. Please try again."); }
    finally { setSaving(false); }
  }
  return <section>
    <div className="workspace-heading"><h1>Styles</h1><p>Choose a style for {organizationName}’s events.</p></div>
    <div className="style-library" aria-label="Available styles">
      {VISUAL_STYLES.map((style) => <Button key={style} disabled={saving} aria-pressed={selected === `preset:${style}`} variant={selected === `preset:${style}` ? "default" : "outline"} onClick={() => select(`preset:${style}`)}>{VISUAL_STYLE_LABELS[style]}{(defaultStyle?.preset === style || (!defaultStyle && style === "neutral")) ? " · Default" : ""}</Button>)}
      {styles.filter((style) => !style.preset).map((style) => <Button disabled={saving} key={style._id} aria-pressed={selected === style._id} variant={selected === style._id ? "default" : "outline"} onClick={() => select(style._id)}>{style.name}{style.isDefault ? " · Default" : ""}</Button>)}
    </div>
    {saved && <p role="status" className="workspace-style-saved">Organization default updated. Existing events keep their current appearance.</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {preset || savedStyle ? <div className="workspace-create-grid">
      <div className="workspace-fields">
        <h2>{preset ? VISUAL_STYLE_LABELS[preset] : savedStyle?.name}</h2>
        <p className="workspace-help">{isDefault ? `This is the default for new events in ${organizationName}.` : `Use this style for new events in ${organizationName}. You can choose a different style for each event.`}</p>
        <Button disabled={saving || isDefault} onClick={() => void saveDefault()}>{saving ? "Saving…" : isDefault ? "Organization default" : "Use as organization default"}</Button>
      </div>
      <aside className="workspace-preview"><p className="workspace-label">Event presentation preview</p>
        <div className="workspace-preview-frame" inert>{!preset || preset === "neutral" ? <EventWelcome name="Demo Night" eventType="demo" submissionUrl={`${origin}${submissionPath("preview")}`} theme={savedStyle?.theme} /> : <StagePresentationPreview stage={buildStagePreviewFixture({ eventName: "Demo Night", eventType: "demo", visualStyle: preset, meetUrl: "" })} submissionUrl={`${origin}${submissionPath("preview")}`} />}</div>
      </aside>
    </div> : <p className="workspace-help">This style is no longer available. Choose another style above.</p>}
  </section>;
}
