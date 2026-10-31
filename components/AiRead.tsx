"use client";

import { SparklesIcon } from "lucide-react";
import { Skeleton } from "@/app/Skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { aiReadChips, splitRowChips, SPONSOR_USE_LABELS, TRACK_FIT_LABELS, type AiReadChip, type AiReadTone, type AiReadView } from "@/lib/ai-read";
import styles from "./AiRead.module.css";

const TRACK_TONE = { strong: "good", partial: "some", weak: "none" } as const satisfies Record<string, AiReadTone>;
const SPONSOR_TONE = { core: "good", used: "good", light: "some", none: "none" } as const satisfies Record<string, AiReadTone>;

function Line({ label, tone, reason }: { label: string; tone: AiReadTone; reason: string | null }) {
  return <div className={styles.line}><span className={styles.level} data-tone={tone}>{label}</span>{reason ? <span>{reason}</span> : null}</div>;
}

/**
 * The AI read under the summary: an overall sentence, then a level and a
 * reason for each picked track and each sponsor. A track with no description
 * has no level. `organiser` adds how to get one.
 */
export function AiReadBlock({ read, organiser = false }: { read: AiReadView; organiser?: boolean }) {
  if (read.status === "checking") {
    return <div className={styles.block} aria-busy="true">
      <span className={styles.heading}><SparklesIcon aria-hidden="true" /> AI read</span>
      <div className={styles.pending}><Skeleton w="70%" h={10} /><Skeleton w="50%" h={10} /></div>
      <span className={styles.note}>Checking…</span>
    </div>;
  }
  const undescribed = read.tracks.filter((track) => !track.described);
  return <div className={styles.block}>
    <span className={styles.heading}><SparklesIcon aria-hidden="true" /> AI read</span>
    {read.overall ? <div className={styles.overall}><strong>Overall:</strong> {read.overall}</div> : null}
    {read.tracks.map((track) => track.level
      ? <Line key={track.id} label={`${track.name} · ${TRACK_FIT_LABELS[track.level]} fit`} tone={TRACK_TONE[track.level]} reason={track.reason} />
      : null)}
    {read.sponsors.map((sponsor) => sponsor.level
      ? <Line key={sponsor.id} label={`${sponsor.name} · ${SPONSOR_USE_LABELS[sponsor.level]}`} tone={SPONSOR_TONE[sponsor.level]} reason={sponsor.reason} />
      : null)}
    {undescribed.map((track) => <div key={track.id} className={styles.line}><span><strong>{track.name}</strong> · no fit level</span></div>)}
    {organiser && undescribed.length > 0 ? <span className={styles.hint}>Add a track description to get a fit level.</span> : null}
    <span className={styles.note}>AI&apos;s read; open the project to check.</span>
  </div>;
}

function ChipTip({ tip, className, children }: { tip: React.ReactNode; className: string; children: React.ReactNode }) {
  return <Tooltip>
    <TooltipTrigger delay={120} render={<span tabIndex={0} />} className={className}>{children}</TooltipTrigger>
    <TooltipContent className={styles.tip}>{tip}</TooltipContent>
  </Tooltip>;
}

function Chip({ chip }: { chip: AiReadChip }) {
  return <ChipTip tip={chip.tip} className={styles.chip}>
    <span className={styles.chipLevel} data-tone={chip.tone}><span className={styles.chipName}>{chip.name}</span><span className={styles.chipSuffix}>&nbsp;· {chip.level}</span></span>
  </ChipTip>;
}

/** Rows: one short chip per track and sponsor, the reason on hover. Past three, two and "+N"; "AI …" while checking. */
export function RowAiChips({ read }: { read: AiReadView | null | undefined }) {
  if (!read) return null;
  if (read.status === "checking") return <span className={styles.chips}><span className={styles.chip}><span className={styles.chipLevel} data-tone="none">AI …</span></span></span>;
  const { shown, rest } = splitRowChips(aiReadChips(read));
  if (shown.length === 0) return null;
  return <span className={styles.chips}>
    {shown.map((chip) => <Chip key={chip.key} chip={chip} />)}
    {rest.length > 0 && <ChipTip className={styles.more} tip={<span className={styles.tipList}>{rest.map((chip) => <span key={chip.key}>{chip.tip}</span>)}</span>}>
      +{rest.length}<span className="sr-only"> more: {rest.map((chip) => `${chip.name} ${chip.level}`).join(", ")}</span>
    </ChipTip>}
  </span>;
}
