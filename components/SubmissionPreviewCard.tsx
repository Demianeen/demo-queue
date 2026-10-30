"use client";

import { useState } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { socialUrl, type SocialKind } from "@/lib/social";
import { youtubeEmbedUrl } from "@/lib/video-embed";
import { cn } from "@/lib/utils";

export type PreviewPerson = {
  name: string;
  presenter: boolean;
  twitter?: string;
  linkedin?: string;
  githubProfile?: string;
};

export type SubmissionPreview = {
  demoTitle: string;
  description: string;
  teamName?: string | null;
  githubUrl?: string | null;
  videoUrl?: string | null;
  people: PreviewPerson[];
  aiSummary?: {
    whatItDoes: string;
    howItWorks: string;
    demoFocus: string;
    usedReadme: boolean;
    sample?: boolean;
    stale: boolean;
  } | null;
};

/** "Sam Lee +2": the presenter and how many others are on the team. */
export function teamShortLabel(preview: Pick<SubmissionPreview, "people">) {
  const [presenter, ...others] = preview.people;
  if (!presenter) return "";
  return others.length ? `${presenter.name} +${others.length}` : presenter.name;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const SOCIALS: { kind: SocialKind; field: "twitter" | "linkedin" | "githubProfile"; label: string }[] = [
  { kind: "twitter", field: "twitter", label: "X" },
  { kind: "linkedin", field: "linkedin", label: "LinkedIn" },
  { kind: "github", field: "githubProfile", label: "GitHub" },
];

function PersonSocials({ person }: { person: PreviewPerson }) {
  const links = SOCIALS.flatMap((social) => {
    const value = person[social.field];
    // Only links on the platform's own site.
    const href = value ? socialUrl(social.kind, value) : null;
    return href ? [{ ...social, href }] : [];
  });
  if (!links.length) return null;
  return (
    <span className="submission-preview-socials">
      {links.map((link) => (
        <a aria-label={`${person.name} on ${link.label}`} href={link.href} key={link.kind} rel="noreferrer" target="_blank">
          {link.label}
        </a>
      ))}
    </span>
  );
}

/**
 * A project title that opens a card with the video, links, AI summary, team
 * and socials when it is hovered or focused. The card is rendered right after
 * the title, so Tab moves from the title into the card's links.
 */
export function SubmissionPreviewTrigger({ preview, className }: { preview: SubmissionPreview; className?: string }) {
  const [container, setContainer] = useState<HTMLSpanElement | null>(null);
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        className={cn("submission-preview-trigger", className)}
        closeDelay={180}
        delay={250}
        render={<button type="button" />}
      >
        {preview.demoTitle}
      </PreviewCard.Trigger>
      <span ref={setContainer} />
      <PreviewCard.Portal container={container}>
        <PreviewCard.Positioner align="start" collisionPadding={16} side="right" sideOffset={10}>
          <PreviewCard.Popup aria-label={`${preview.demoTitle} details`} className="submission-preview" role="dialog">
            <SubmissionPreviewBody preview={preview} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

/** The card's content: video, links, AI summary and team. Also shown inline in the Judging detail panel. */
export function SubmissionPreviewBody({ preview }: { preview: SubmissionPreview }) {
  const embed = youtubeEmbedUrl(preview.videoUrl);
  return (
    <>
      <div className="submission-preview-top">
        {embed ? (
          <div className="submission-preview-video">
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              src={embed}
              title={`${preview.demoTitle} demo video`}
            />
          </div>
        ) : (
          <div className="submission-preview-video is-empty">{preview.videoUrl ? "Video opens in a new tab" : "No demo video"}</div>
        )}
        <div className="submission-preview-intro">
          <strong>{preview.demoTitle}</strong>
          {preview.description ? <span className="submission-preview-description">{preview.description}</span> : null}
          <span className="submission-preview-links">
            {preview.githubUrl ? <a href={preview.githubUrl} rel="noreferrer" target="_blank">GitHub <ExternalLinkIcon aria-hidden="true" /></a> : null}
            {preview.videoUrl ? <a href={preview.videoUrl} rel="noreferrer" target="_blank">Video <ExternalLinkIcon aria-hidden="true" /></a> : null}
          </span>
        </div>
      </div>
      {preview.aiSummary ? (
        <div className="submission-preview-summary">
          <strong><SparklesIcon aria-hidden="true" /> AI summary</strong>
          <ul>
            <li><b>What it does:</b> {preview.aiSummary.whatItDoes || "Not described"}</li>
            <li><b>How it works:</b> {preview.aiSummary.howItWorks || "Not described"}</li>
            <li><b>What to look for in the demo:</b> {preview.aiSummary.demoFocus || "Not described"}</li>
          </ul>
          <small>
            {preview.aiSummary.sample ? "Sample summary (practice). The real model is off for this practice event." : `Written by AI from the team's description${preview.aiSummary.usedReadme ? " and README" : ""}. Check it against the demo.`}
            {preview.aiSummary.stale ? " The project changed since; a new summary is on its way." : null}
          </small>
        </div>
      ) : null}
      <div className="submission-preview-people">
        {preview.teamName ? <span className="submission-preview-team">{preview.teamName}</span> : null}
        {preview.people.map((person, index) => (
          <div className="submission-preview-person" key={`${person.name}-${index}`}>
            <span aria-hidden="true" className="submission-preview-avatar">{initials(person.name)}</span>
            <span className="submission-preview-name">
              {person.name}
              {person.presenter ? <small> presenter</small> : null}
            </span>
            <PersonSocials person={person} />
          </div>
        ))}
      </div>
    </>
  );
}
