import { DEVDAY_THEME_NAME } from "@/lib/visual-style";
import { DevDayBrand } from "@/components/DevDayBrand";
import { DevDayCharacter } from "@/components/DevDayCharacter";

export function DevDayHero({ eventName, eventType, mode }: {
  eventName: string; eventType: "demo" | "hackathon"; mode: "submission" | "status";
}) {
  return <aside className="devday-hero" aria-label={`${DEVDAY_THEME_NAME} event branding`}>
    <DevDayBrand />
    <div className="devday-hero-copy">
      <p className="devday-eyebrow">{eventType === "hackathon" ? "Community hackathon" : "Demo night"}</p>
      <h2>{mode === "status" ? <>You built it.<br />Now show it.</> : <>Small demo.<br />Big energy.</>}</h2>
      <p className="devday-event-name">{eventName}</p>
      <p className="devday-hero-note">{mode === "status" ? "Your place in the lineup, and everything that comes next." : "Bring what you built. We’ll make room for it."}</p>
    </div>
    <div className="devday-hero-cast">
      <DevDayCharacter variant="purple" className="devday-hero-main-dot" />
      <DevDayCharacter variant="green" className="devday-hero-small-dot" />
    </div>
  </aside>;
}
