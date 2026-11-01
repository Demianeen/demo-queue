"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Expand, ExternalLink, PanelRight, Presentation, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { absoluteUrl, stagePath, submissionPath } from "@/lib/routes";
import type { EventPhase } from "@/lib/event-phase";
import { PhaseMenu } from "./PhaseMenu";
import { errorText } from "./changes";
import styles from "./live.module.css";

/**
 * The phase control, Share and Room, in the header of every tab of an event.
 * Share holds both links: the submit link for people, and the presentation
 * view for the projector. It also opens from the Room panel, or with S.
 */
export function EventHeaderActions({ slug, eventName, eventType, phase, roomOpen, onToggleRoom }: {
  slug: string; eventName: string; eventType: "demo" | "hackathon"; phase: EventPhase; roomOpen: boolean; onToggleRoom: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const setStageScreenMode = useMutation(api.events.setStageScreenMode);
  const submitUrl = absoluteUrl(submissionPath(slug));
  const stageUrl = absoluteUrl(stagePath(slug));
  const openStage = () => window.open(stagePath(slug), "_blank", "noopener");

  async function copy(url = submitUrl, done = "Submit link copied") {
    try { await navigator.clipboard.writeText(url); toast(done); } catch { toast.error("Could not copy. Select the link and copy it instead."); }
  }
  async function putOnStage() {
    try { await setStageScreenMode({ slug, mode: "qr" }); setShareOpen(false); toast("The stage shows the submit QR code"); } catch (error) { toast.error(errorText(error, "Could not change the stage.")); }
  }

  const commands = useMemo<Command[]>(() => [
    { id: "share", group: "This page", label: "Share the submit link", run: () => setShareOpen(true) },
    { id: "share-copy", group: "This page", label: "Copy the submit link", run: () => void copy() },
    { id: "share-fullscreen", group: "This page", label: "Show the submit QR full screen", keys: ["F"], run: () => setFullscreen(true) },
    { id: "share-stage", group: "This page", label: "Put the submit QR on stage", run: () => void putOnStage() },
    { id: "open-stage", group: "This page", label: "Open presentation view", keys: ["S"], run: openStage },
    { id: "copy-stage", group: "This page", label: "Copy the presentation view link", run: () => void copy(stageUrl, "Presentation link copied") },
    { id: "room", group: "This page", label: roomOpen ? "Close the Room panel" : "Open the Room panel", keys: ["R"], run: onToggleRoom },
  ], [slug, roomOpen, onToggleRoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useCommands("event-header", commands);

  return <>
    <PhaseMenu slug={slug} eventType={eventType} phase={phase} />
    <Popover open={shareOpen} onOpenChange={setShareOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}><QrCode aria-hidden />Share</PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className={styles.share}>
        <div className={styles.sideHead}><h2 className="text-[13px] font-medium">Submit link</h2></div>
        <div className={styles.shareQr}><QRCodeSVG value={submitUrl} size={176} marginSize={1} role="img" aria-label="QR code for the submit link" /></div>
        <div className={styles.shareUrl}><code>{submitUrl}</code><Button variant="ghost" size="xs" onClick={() => void copy()}><Copy aria-hidden />Copy</Button></div>
        <div className={styles.shareActions}>
          <Button variant="outline" size="sm" onClick={() => { setShareOpen(false); setFullscreen(true); }}><Expand aria-hidden />Show full screen</Button>
          <Button variant="outline" size="sm" onClick={() => void putOnStage()}><Presentation aria-hidden />Put on stage</Button>
        </div>
        <p className={styles.note}>Full screen fills this laptop with the QR so you can hold it up to someone. Esc closes it.</p>
        <div className={styles.sideHead}><h2 className="text-[13px] font-medium">Presentation view</h2></div>
        <div className={styles.shareUrl}><code>{stageUrl}</code><Button variant="ghost" size="xs" onClick={() => void copy(stageUrl, "Presentation link copied")}><Copy aria-hidden />Copy</Button></div>
        <div className={styles.shareActions}>
          <Button variant="outline" size="sm" onClick={() => { setShareOpen(false); openStage(); }}><ExternalLink aria-hidden />Open</Button>
        </div>
        <p className={styles.note}>Open it on the laptop that drives the projector. It shows what you pick in Room: the submit QR, the lineup and the timer.</p>
      </PopoverContent>
    </Popover>
    <ShortcutTooltip label="What the room sees" keys={["R"]}>
      <Button variant="outline" size="sm" aria-pressed={roomOpen} aria-controls={roomOpen ? "room-panel" : undefined} data-pressed={roomOpen ? "" : undefined} onClick={onToggleRoom}><PanelRight aria-hidden />Room</Button>
    </ShortcutTooltip>
    {fullscreen && <FullScreenQr url={submitUrl} eventName={eventName} onClose={() => setFullscreen(false)} />}
  </>;
}

/** The submit QR over the whole window. Esc or Close ends it. */
export function FullScreenQr({ url, eventName, onClose }: { url: string; eventName: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(<div className={`dq-app ${styles.fullscreen}`} role="dialog" aria-modal="true" aria-label={`Submit to ${eventName}`}>
    <Button ref={closeRef} variant="outline" size="sm" className={styles.fullscreenClose} onClick={onClose}><X aria-hidden />Close (Esc)</Button>
    <h2>Submit to {eventName}</h2>
    <div className={styles.fullscreenQr}><QRCodeSVG value={url} size={720} marginSize={2} role="img" aria-label="QR code for the submit link" /></div>
    <code>{url}</code>
  </div>, document.body);
}
