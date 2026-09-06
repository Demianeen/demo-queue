import { QRCodeSVG } from "qrcode.react";
import { DEFAULT_EVENT_THEME, eventThemeProperties, type EventTheme } from "@/lib/event-theme";

/** Shared by the creation preview and the real neutral presentation's join screen. */
export function EventWelcome({ name, eventType, submissionUrl, closed = false, theme = DEFAULT_EVENT_THEME }: {
  name: string; eventType: "demo" | "hackathon"; submissionUrl: string; closed?: boolean; theme?: EventTheme;
}) {
  return <div className="event-welcome" style={eventThemeProperties(theme)}>
    <h2>{name.trim() || "Demo Night"}</h2>
    <p>{closed ? "Submissions are closed" : eventType === "hackathon" ? "Ready to share your project?" : "Ready for your demo?"}</p>
    {!closed && <><a className="event-welcome-action" href={submissionUrl}>{eventType === "hackathon" ? "Submit your project" : "Join the queue"}</a>
      <QRCodeSVG value={submissionUrl} size={108} marginSize={2} title="Scan to submit" bgColor="#ffffff" fgColor="#101113" />
    </>}
  </div>;
}
