// Startseite: die letzten Partien mit dem, was in der Eröffnung passiert ist, wie du danach standest, und einem Mini-Brett
// mit Stellung und Zug der Abweichung. Antippen öffnet die Partie am Brett (Partien-Seite).
import { useApp } from './store';
import { useAssessments } from './gameEvals';
import { useReviewedGames } from './gameRows';
import { GameCard } from './GameCard';
import { openGameFromHome } from './GamesView';
import { useInert } from './inert';
import { setView } from './store';

const SHOW = 5;

export function RecentGames() {
  const inert = useInert();
  const { rows, color } = useReviewedGames(!inert);
  const notation = useApp((s) => s.settings.ui.notation);
  const recent = rows.slice(0, SHOW);
  const { of, pending } = useAssessments(recent, color, !inert);
  return (
    <section className="card recent-games" data-testid="home-games">
      <header className="rg-head">
        <h2>Letzte Partien</h2>
        <button className="btn small ghost" onClick={() => setView('games')}>
          Alle Partien
        </button>
      </header>
      {recent.length ? (
        <ul className="game-cards">
          {recent.map((r) => (
            <GameCard key={r.key} row={r} a={of(r.key)} pending={pending > 0} color={color} notation={notation} onOpen={() => openGameFromHome(r.key)} />
          ))}
        </ul>
      ) : (
        <p className="hint">Keine Partien mit {color === 'white' ? 'Weiß' : 'Schwarz'} – oben rechts das andere Repertoire wählen.</p>
      )}
    </section>
  );
}
