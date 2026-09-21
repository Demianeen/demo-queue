import { AstraBackdrop } from "@/components/AstraBackdrop";
import { AstraBrand } from "@/components/AstraBrand";

export function AstraHero({
  eventName,
  eventType,
  mode,
}: {
  eventName: string;
  eventType: "demo" | "hackathon";
  mode: "submission" | "status";
}) {
  return (
    <aside className="astra-hero" aria-label="GPT-6 Astra event branding">
      <AstraBackdrop animated={false} />
      <AstraBrand />
      <div className="astra-hero-copy">
        <p className="astra-eyebrow">{eventName}</p>
        <h2>{mode === "status" ? "You’re part of it." : "Bring your next idea."}</h2>
        <p>
          {mode === "status"
            ? "Keep your private link to follow what happens next."
            : eventType === "hackathon"
              ? "Share what your team built. Show us what’s possible."
              : "Something to show. A room to share it with."}
        </p>
      </div>
    </aside>
  );
}
