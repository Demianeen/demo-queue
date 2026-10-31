import type { Celebration as CelebrationCopy } from "@/lib/participant-status";
import styles from "./results.module.css";

/** A five-pointed star in a ring, for a finalist. */
export function FinalistStar({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="34" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M36 16 L41.9 28.6 L55.6 30.1 L45.4 39.4 L48.2 53 L36 46.1 L23.8 53 L26.6 39.4 L16.4 30.1 L30.1 28.6 Z" fill="currentColor" />
    </svg>
  );
}

/** A medal: gold, silver or bronze with its place. */
export function Medal({ place, className }: { place: 1 | 2 | 3; className?: string }) {
  return <span aria-hidden="true" className={`${styles.medal} ${className ?? ""}`} data-place={place}>{place}</span>;
}

/**
 * The status page's finalist or winner block. One block for every style: it
 * reads the event's tokens (accent, display font, radius), so custom Base
 * styles get it too. Only the medal colours are shared.
 */
export function Celebration({ celebration }: { celebration: CelebrationCopy }) {
  return (
    <section className={styles.celebration} data-place={celebration.place ?? undefined} aria-labelledby="celebration-headline">
      <svg aria-hidden="true" className={styles.rings} viewBox="0 0 260 260">
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="130" cy="130" r="40" /><circle cx="130" cy="130" r="80" /><circle cx="130" cy="130" r="120" />
        </g>
      </svg>
      {celebration.place ? <Medal place={celebration.place} className={styles.celebrationMedal} /> : <FinalistStar className={styles.star} />}
      <div className={styles.celebrationCopy}>
        <span className={styles.celebrationKicker}>{celebration.kicker}</span>
        <h2 id="celebration-headline" className={styles.celebrationHeadline}>
          {celebration.place ? <><span className={styles.headlineDigit}>{celebration.place}</span>{celebration.headline.slice(1)}</> : celebration.headline}
        </h2>
        <p className={styles.celebrationSentence}>{celebration.sentence}</p>
      </div>
    </section>
  );
}
