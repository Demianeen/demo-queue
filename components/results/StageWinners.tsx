import type { StagePresentationData } from "@/lib/stage-presentation";
import { Medal } from "./Celebration";
import styles from "./results.module.css";

type Results = NonNullable<StagePresentationData["results"]>;

/**
 * The stage once the event finishes: the podium (2nd, 1st, 3rd from the
 * left; 1st, 2nd, 3rd for screen readers) and, when the organiser chose it,
 * the other finalists. Colours and fonts come from the stage's own style.
 */
export function StageWinners({ eventName, results }: { eventName: string; results: Results }) {
  const finalists = results.showFinalists ? results.finalists : [];
  return (
    <section className={styles.winners} data-with-finalists={finalists.length > 0 || undefined} aria-labelledby="stage-winners-title">
      <header className={styles.winnersHead}>
        <p className={styles.winnersEvent}>{eventName}</p>
        <h1 id="stage-winners-title" className={styles.winnersTitle}>The winners</h1>
      </header>
      <ol className={styles.podium} data-count={results.winners.length}>
        {results.winners.map((winner) => (
          <li key={winner.place} className={styles.podiumPlace} data-place={winner.place}>
            <Medal place={winner.place} className={styles.podiumMedal} />
            <span className="sr-only">{["1st", "2nd", "3rd"][winner.place - 1]} place: </span>
            <span className={styles.podiumTitle}>{winner.demoTitle}</span>
            <span className={styles.podiumTeam}>{winner.teamName}</span>
            <span aria-hidden="true" className={styles.podiumStep} />
          </li>
        ))}
      </ol>
      {finalists.length > 0 ? (
        <section className={styles.finalists} aria-labelledby="stage-finalists-title">
          <h2 id="stage-finalists-title" className={styles.finalistsTitle}><span aria-hidden="true">★ </span>Finalists</h2>
          <ul className={styles.finalistCards}>
            {finalists.map((finalist, index) => (
              <li key={`${finalist.demoTitle}-${index}`} className={styles.finalistCard}>
                <span className={styles.finalistTitle}>{finalist.demoTitle}</span>
                <span className={styles.finalistTeam}>{finalist.teamName}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
