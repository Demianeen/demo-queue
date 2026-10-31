import type { StagePresentationData } from "@/lib/stage-presentation";
import { Medal } from "./Celebration";
import styles from "./results.module.css";

type Results = NonNullable<StagePresentationData["results"]>;

const PLACE_LABELS = ["1st place", "2nd place", "3rd place"];

/**
 * The stage once the event finishes: the podium (2nd, 1st, 3rd from the
 * left; 1st, 2nd, 3rd for screen readers) and, when the organiser chose it,
 * the other finalists. Colours and fonts come from the stage's own style.
 * The lineup layout keeps a style's own pitching screen instead: 1st place
 * where the presenter's name goes, the rest in the Coming up panel.
 */
export function StageWinners({ eventName, results, layout = "podium" }: { eventName: string; results: Results; layout?: "podium" | "lineup" }) {
  const finalists = results.showFinalists ? results.finalists : [];
  if (layout === "lineup") return <LineupWinners eventName={eventName} results={results} finalists={finalists} />;
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

function LineupWinners({ eventName, results, finalists }: { eventName: string; results: Results; finalists: Results["finalists"] }) {
  const [first, ...rest] = [...results.winners].sort((a, b) => a.place - b.place);
  const others = [
    ...rest.map((winner) => ({ key: `place-${winner.place}`, position: <>{PLACE_LABELS[winner.place - 1]}</>, ...winner })),
    ...finalists.map((finalist, index) => ({ key: `finalist-${index}`, position: <><span aria-hidden="true">★</span><span className="sr-only">Finalist</span></>, ...finalist })),
  ];
  return (
    <section className="stage-grid" aria-labelledby="stage-winners-title">
      <div className="stage-main">
        <div className="stage-current-content">
          <h1 id="stage-winners-title" className="sr-only">{eventName}: the winners</h1>
          <p className="stage-label">{first ? PLACE_LABELS[first.place - 1] : null}</p>
          <div className="stage-title">{first?.demoTitle}</div>
          <div className="stage-subtitle">{first?.teamName}</div>
        </div>
      </div>
      {others.length > 0 ? (
        <aside className="stage-side">
          <div className="stage-lineup-stack">
            <div className="stage-lineup-header">
              <p className="stage-label">{finalists.length > 0 ? "Winners and finalists" : "Winners"}</p>
              <span>{eventName}</span>
            </div>
            <ol className="stage-lineup-list">
              {others.map((item, index) => (
                <li key={item.key} className={index < rest.length ? "is-next" : "is-later"}>
                  <span className="stage-lineup-position">{item.position}</span>
                  <span className="stage-lineup-copy">
                    <span className="stage-lineup-person">{item.demoTitle}</span>
                    <span className="stage-lineup-demo">{item.teamName}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
