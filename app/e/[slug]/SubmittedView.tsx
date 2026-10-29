"use client";

import { CheckIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { participantPath } from "@/lib/routes";
import { socialUrl, type SocialKind } from "@/lib/social";

export type SubmittedViewData = NonNullable<FunctionReturnType<typeof api.events.getSubmittedView>>;

const submittedAtFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function displayUrl(value: string) {
  return value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

const SOCIAL_LABELS: Array<[SocialKind, "twitter" | "linkedin" | "githubProfile", string]> = [
  ["twitter", "twitter", "X"],
  ["linkedin", "linkedin", "LinkedIn"],
  ["github", "githubProfile", "GitHub"],
];

export function SubmittedView({
  slug,
  participantToken,
  view,
  onStartOver,
}: {
  slug: string;
  participantToken: string;
  view: SubmittedViewData;
  onStartOver: () => void;
}) {
  const isTeam = view.eventType === "hackathon";
  const statusPath = participantPath(slug, participantToken);
  const rows: Array<{ label: string; value: string; href?: string }> = [
    ...(isTeam && view.teamName ? [{ label: "Team name", value: view.teamName }] : []),
    { label: isTeam ? "Project" : "Demo", value: view.demoTitle },
    { label: "Description", value: view.description },
    { label: "Tracks", value: view.tracks.length ? view.tracks.join(" · ") : "None" },
    ...(view.githubUrl ? [{ label: "GitHub", value: displayUrl(view.githubUrl), href: view.githubUrl }] : []),
    ...(view.videoUrl ? [{ label: "Demo video", value: displayUrl(view.videoUrl), href: view.videoUrl }] : []),
  ];

  return (
    <div className="submitted-view">
      <header className="submitted-view-header">
        <span className="submitted-badge">
          <CheckIcon aria-hidden size={14} strokeWidth={2.6} />
          Submitted {submittedAtFormat.format(view.submittedAt)}
        </span>
        <h1>{isTeam ? "Your team is in" : "Your demo is in"}</h1>
        <p className="lead">
          This is what you sent.
          {view.email && view.emailConfigured
            ? ` A copy went to ${view.email} with your private status link.`
            : " Your private status page has the Meet link once you are scheduled."}
        </p>
      </header>

      <div className="submitted-actions">
        <a className="button" href={statusPath}>
          Open status page
        </a>
        <a className="button secondary" href={`${statusPath}#contact`}>
          Edit contact details
        </a>
      </div>

      <dl className="submitted-details" aria-label="What you submitted">
        {rows.map((row) => (
          <div className="submitted-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              {row.href ? (
                <a href={row.href} rel="noreferrer" target="_blank">
                  {row.value}
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
        <div className="submitted-row">
          <dt>{isTeam ? "Team" : "Socials"}</dt>
          <dd>
            <ul className="submitted-people">
              {view.people.slice(0, isTeam ? undefined : 1).map((person, index) => (
                <li key={`${person.name}-${index}`}>
                  {isTeam ? <strong>{person.name}</strong> : null}
                  {isTeam && person.presenter ? <span className="muted">Presenter</span> : null}
                  {SOCIAL_LABELS.map(([kind, field, label]) => {
                    const value = person[field];
                    if (!value) return null;
                    const href = socialUrl(kind, value);
                    return href ? (
                      <a href={href} key={kind} rel="noreferrer" target="_blank">
                        {label}
                      </a>
                    ) : (
                      <span className="muted" key={kind}>
                        {label}
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <p className="muted submitted-note">
        {isTeam
          ? "Need to change the project itself? Ask an organizer. Project details lock once submitted so judges see what you sent."
          : "Need to change your demo? Ask an organizer. Details lock once submitted."}
      </p>
      <p className="submitted-note">
        <button className="submitted-start-over" onClick={onStartOver} type="button">
          Not you? Start a new submission
        </button>
      </p>
    </div>
  );
}
