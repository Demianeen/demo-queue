import Image from "next/image";

type OutpostHeroProps = {
  eventName: string;
  eventType: "demo" | "hackathon";
  mode: "submission" | "status";
};

export function OutpostHero({ eventName, eventType, mode }: OutpostHeroProps) {
  const isHackathon = eventType === "hackathon";

  return (
    <aside className="outpost-hero" aria-label="Outpost event branding">
      <div className="outpost-hero-brand">
        <Image
          src="/outpost/logo-white.png"
          alt="Outpost"
          width={260}
          height={85}
          priority
        />
        <strong>Build at the frontier</strong>
      </div>
      <div className="outpost-hero-copy">
        <span className="outpost-hero-rule" aria-hidden />
        <p>{eventName}</p>
        <h2>
          {mode === "submission"
            ? isHackathon
              ? "Submit your project"
              : "Join the demo queue"
            : "Your submission"}
        </h2>
        <span>
          {mode === "submission"
            ? isHackathon
              ? "Share what your team built for the frontier."
              : "Tell the room what you are ready to demo."
            : isHackathon
              ? "Keep this private link to follow your project status."
              : "Keep this private link to follow your place in the demo queue."}
        </span>
      </div>
    </aside>
  );
}
