// Startseite: die letzten Partien mit dem, was in der Eröffnung passiert ist, wie du danach standest, und einem Mini-Brett
// mit Stellung und Zug der Abweichung. Antippen öffnet die Partie am Brett (Partien-Seite). Darunter kurz: stärkste und
// schwächste Eröffnung mit dieser Farbe → Statistik.
import { useMemo } from 'react';
import { openingOf } from '../core/gameReview';
import { familyDe } from '../core/openings';
import { bestWorst, openingStats } from '../core/openingStats';
import { setView, useApp } from './store';
import { useAssessments } from './gameEvals';
import { useEco, useReviewedGames } from './gameRows';
import { gameKey, useMyGames } from './games';
import { GameCard } from './GameCard';
import { openGameFromHome } from './GamesView';
import { useInert } from './inert';

const SHOW = 5;

export function RecentGames() {
  const inert = useInert();
  const { rows, color } = useReviewedGames(!inert);
  const stored = useMyGames();
  const notation = useApp((s) => s.settings.ui.notation);
  const recent = rows.slice(0, SHOW);
  const { of, pending } = useAssessments(recent, color, !inert);
  const eco = useEco(!inert);
  const bw = useMemo(() => {
    if (!eco || !stored) return {};
    const all = stored.games.map((g) => ({ game: g, key: gameKey(g) }));
    const names = new Map(all.map((x) => [x.key, openingOf(x.game.m.split(' '), eco)]));
    return bestWorst(
      openingStats(all, color === 'white' ? 'w' : 'b', (k) => {
        const n = names.get(k);
        return n ? familyDe(n) : undefined;
      }),
    );
  }, [eco, stored, color]);
  const toStats = () => {
    useApp.setState({ gamesTab: 'stats' });
    setView('games');
  };
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
      {(bw.best || bw.worst) && (
        <button className="rg-foot" onClick={toStats} data-testid="home-opening-bw">
          <span>
            Mit {color === 'white' ? 'Weiß' : 'Schwarz'}
            {bw.best && (
              <>
                {' '}
                am stärksten: <b className="good">{bw.best.family}</b> {bw.best.score} %
              </>
            )}
            {bw.worst && (
              <>
                {bw.best ? ' · ' : ' '}am schwächsten: <b className="bad">{bw.worst.family}</b> {bw.worst.score} %
              </>
            )}
          </span>
          <span className="link-btn">Statistik</span>
        </button>
      )}
    </section>
  );
}
