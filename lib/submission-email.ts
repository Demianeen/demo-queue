// The confirmation email a team gets after submitting, and again on request.
// Pure functions so the copy and the escaping can be tested without Convex.

export type SubmissionEmailInput = {
  reason: "submitted" | "resend";
  eventName: string;
  eventType: "demo" | "hackathon";
  recipientName?: string;
  demoTitle: string;
  teamName?: string;
  people: string[];
  tracks: string[];
  githubUrl?: string;
  videoUrl?: string;
  statusUrl: string;
};

export type SubmissionEmail = { subject: string; html: string; text: string };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** One line of plain text: no line breaks, no control characters. */
function oneLine(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The From header: "<event> via Demo Queue <address>". The configured sender
 * may be a bare address or "Name <address>"; only its address is used.
 */
export function emailSender(eventName: string, configuredFrom: string) {
  const address = configuredFrom.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? configuredFrom.trim();
  const name = oneLine(eventName).replace(/["\\<>,;:@()[\]]/g, "").slice(0, 60).trim();
  return name ? `"${name} via Demo Queue" <${address}>` : `"Demo Queue" <${address}>`;
}

export function buildSubmissionEmail(input: SubmissionEmailInput): SubmissionEmail {
  const isTeam = input.eventType === "hackathon";
  const eventName = oneLine(input.eventName);
  const title = oneLine(input.demoTitle);
  const firstName = oneLine(input.recipientName ?? "").split(" ")[0];
  const subject =
    input.reason === "resend"
      ? `Your status link for ${title} at ${eventName}`
      : `You submitted ${title} to ${eventName}`;
  const heading =
    input.reason === "resend"
      ? "Here is your status link"
      : `${isTeam ? "Your team is in" : "Your demo is in"}${firstName ? `, ${firstName}` : ""}`;
  const intro =
    input.reason === "resend"
      ? `You asked for the status link for ${title} again. The button below opens your private status page, where the Meet link appears if you are scheduled to present.`
      : `Thanks for submitting ${title}. Keep this email: the button below opens your private status page, where the Meet link appears if you are scheduled to present.`;
  const footer = isTeam
    ? input.reason === "resend"
      ? "Only people with the link can open the status page, so do not forward it outside your team."
      : "Everyone on the team gets this email. Only people with the link can open the status page, so do not forward it outside your team."
    : "Only people with the link can open the status page, so do not forward it.";

  const rows: Array<[string, string, string?]> = [[isTeam ? "Project" : "Demo", title]];
  if (isTeam) {
    const people = input.people.map(oneLine).filter(Boolean).join(", ");
    const team = [oneLine(input.teamName ?? ""), people].filter(Boolean).join(" · ");
    if (team) rows.push(["Team", team]);
  }
  rows.push(["Tracks", input.tracks.length ? input.tracks.map(oneLine).join(" · ") : "None"]);
  if (input.githubUrl) rows.push(["GitHub", displayUrl(input.githubUrl), input.githubUrl]);
  if (input.videoUrl) rows.push(["Demo video", displayUrl(input.videoUrl), input.videoUrl]);

  const text = [
    heading,
    "",
    intro,
    "",
    `Open your status page: ${input.statusUrl}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    footer,
  ].join("\n");

  const rowHtml = rows
    .map(([label, value, href]) => {
      const cell = href && isHttpUrl(href) ? `<a href="${escapeHtml(href)}" style="color:#1a1a18">${escapeHtml(value)}</a>` : escapeHtml(value);
      return `<tr><td style="padding:8px 12px 8px 0;color:#5a5a52;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:8px 0;font-size:14px;color:#1a1a18">${cell}</td></tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #ddd9ce;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #eeeae0;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase">${escapeHtml(eventName)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 10px;font-size:24px;line-height:1.25">${escapeHtml(heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#4a4a44">${escapeHtml(intro)}</p>
<a href="${escapeHtml(input.statusUrl)}" style="display:inline-block;background:#1a1a18;color:#f4f1ea;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:20px">Open your status page</a>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #eeeae0;width:100%">${rowHtml}</table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#5a5a52">${escapeHtml(footer)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function displayUrl(value: string) {
  return value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}
