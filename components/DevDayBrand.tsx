import { DEVDAY_THEME_NAME } from "@/lib/visual-style";

export function DevDayBrand({ className = "" }: { className?: string }) {
  return <div className={`devday-brand ${className}`} aria-label={`OpenAI ${DEVDAY_THEME_NAME}`}>
    <span className="devday-openai">OpenAI</span>
    <span className="devday-wordmark">DevDay Exchange<span className="devday-community-wordmark">Community Hackathon</span></span>
  </div>;
}
