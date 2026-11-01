"use client";

import { SparklesIcon } from "lucide-react";
import { Skeleton } from "@/app/Skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { aiReadChips, BUILT_STATUS_LABELS, BUILT_STATUS_TONES, buildFactsLine, buildReadLine, splitRowChips, SPONSOR_USE_LABELS, TRACK_FIT_LABELS, type AiDetailsView, type AiReadChip, type AiReadTone, type AiReadView } from "@/lib/ai-read";
import styles from "./AiRead.module.css";

const TRACK_TONE = { strong: "good", partial: "some", weak: "none" } as const satisfies Record<string, AiReadTone>;
const SPONSOR_TONE = { core: "good", used: "good", light: "some", none: "none" } as const satisfies Record<string, AiReadTone>;

/** One summary line, as the panel shows it; empty text means the team's text says nothing about it. */
export type AiSummaryRow = { label: string; text: string };

/** The panel's top line: where the AI got its text, and that it can be wrong. */
export function aiSummaryCaveat(summary: { sample?: boolean; usedReadme?: boolean; usedCode?: boolean; stale?: boolean; build?: unknown }) {
  // A v3 summary read the code as it was at the deadline.
  const code = summary.build ? ["code at the deadline"] : summary.usedCode ? ["code"] : [];
  const sources = ["the team's description", ...(summary.usedReadme ? ["README"] : []), ...code];
  const read = sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : sources[0];
  const source = summary.sample
    ? "Sample (practice). The real model is off for this event."
    : `From ${read}. Check it against the demo.`;
  return summary.stale ? `${source} The project changed; a new one is on its way.` : source;
}

/** The read: the overall sentence first, then a level and a reason for each picked track and each sponsor. */
function ReadLines({ read, organiser }: { read: AiReadView; organiser: boolean }) {
  if (read.status === "checking") {
    return <div className={styles.pending} aria-busy="true"><Skeleton w="70%" h={10} /><Skeleton w="50%" h={10} /><span className={styles.note}>Checking the tracks and sponsors…</span></div>;
  }
  const undescribed = read.tracks.filter((track) => !track.described);
  return <>
    {read.overall ? <p className={styles.verdict}>{read.overall}</p> : null}
    <div className={styles.fit}>
      {read.tracks.map((track) => track.level
        ? <Fit key={track.id} label={`${track.name} · ${TRACK_FIT_LABELS[track.level]} fit`} tone={TRACK_TONE[track.level]} reason={track.reason} />
        : null)}
      {read.sponsors.map((sponsor) => sponsor.level
        ? <Fit key={sponsor.id} label={`${sponsor.name} · ${SPONSOR_USE_LABELS[sponsor.level]}`} tone={SPONSOR_TONE[sponsor.level]} reason={sponsor.reason} />
        : null)}
      {undescribed.map((track) => <Fit key={track.id} label={`${track.name} · no level`} tone="none" reason={organiser ? "Add a track description to get a level." : null} />)}
    </div>
  </>;
}

function Fit({ label, tone, reason }: { label: string; tone: AiReadTone; reason: string | null }) {
  return <div className={styles.fitRow}><span className={styles.level} data-tone={tone}>{label}</span>{reason ? <span className={styles.reason}>{reason}</span> : null}</div>;
}

/**
 * The AI card on the judge page and the organiser's project panel: one
 * heading and one caveat in the top line, then the read (judges have a couple
 * of minutes a project, so the judgement comes first), then the summary lines.
 * `rows` is "pending" while the summary is being written. `details` is what a
 * v3 summary adds (build facts, built or stubbed, questions); older summaries
 * have none and show as before.
 */
export function AiPanel({ headingId, caveat, read, rows, details, organiser = false }: {
  headingId?: string;
  caveat: string;
  read: AiReadView | null | undefined;
  rows: AiSummaryRow[] | "pending";
  details?: AiDetailsView | null;
  organiser?: boolean;
}) {
  const pending = rows === "pending";
  const parts = pending ? [] : details?.builtVsStubbed ?? [];
  const questions = pending ? [] : details?.questions ?? [];
  const build = pending ? null : details?.build ?? null;
  return <section aria-labelledby={headingId} aria-busy={pending || undefined} className={styles.panel}>
    <div className={styles.head}>
      <h2 className={styles.title} id={headingId}><SparklesIcon aria-hidden="true" /> AI</h2>
      <span className={styles.caveat}>{caveat}</span>
    </div>
    <div className={styles.body}>
      {read ? <ReadLines read={read} organiser={organiser} /> : null}
      {build ? <div className={styles.build}>
        <p className={styles.buildFacts}><span className={styles.buildLabel}>Build</span>{buildFactsLine(build)}</p>
        <p className={styles.note}>{buildReadLine(build)} Counted by the app, not the AI, from commit times the team&apos;s git recorded.</p>
      </div> : null}
      {pending
        ? <div className={styles.pending}><Skeleton h={12} /><Skeleton w="86%" h={12} /><Skeleton w="72%" h={12} /></div>
        : rows.length > 0 ? <dl className={styles.rows}>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt>{row.text ? <dd>{row.text}</dd> : <dd className={styles.missing}>Not described</dd>}</div>)}</dl> : null}
      {parts.length > 0 ? <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Built or stubbed</h3>
        <ul className={styles.parts}>{parts.map((part, index) => <li key={`${index}-${part.part}`} className={styles.part}>
          <span className={styles.partHead}><span className={styles.partName}>{part.part}</span><span className={styles.level} data-tone={BUILT_STATUS_TONES[part.status]}>{BUILT_STATUS_LABELS[part.status]}</span></span>
          {part.evidence ? <span className={styles.reason}>{part.evidence}</span> : null}
        </li>)}</ul>
      </div> : null}
      {questions.length > 0 ? <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Ask the team</h3>
        <ol className={styles.questions}>{questions.map((question, index) => <li key={index}>{question}</li>)}</ol>
      </div> : null}
    </div>
  </section>;
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
