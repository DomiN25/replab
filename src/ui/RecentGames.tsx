// Startseite: die letzten Partien beider Farben – was in der Eröffnung passiert ist, wie du danach standest, und ein Mini-Brett
// aus deiner Sicht (deine Farbe unten) mit Stellung und Zug der Abweichung. Antippen öffnet die Partie am Brett. Darunter kurz:
// stärkste und schwächste Eröffnung je Farbe → Statistik.
import { useMemo } from 'react';
import { openingOf } from '../core/gameReview';
import { familyDe } from '../core/openings';
import { bestWorst, openingStats, type OpeningStat } from '../core/openingStats';
import { setView, useApp } from './store';
import { useAssessments } from './gameEvals';
import { useEco, useRecentBoth } from './gameRows';
import { gameKey, useMyGames } from './games';
import { GameCard } from './GameCard';
import { openGameFromHome } from './GamesView';
import { useInert } from './inert';

const SHOW = 5;

export function RecentGames() {
  const inert = useInert();
  const recent = useRecentBoth(SHOW, !inert);
  const stored = useMyGames();
  const notation = useApp((s) => s.settings.ui.notation);
  const { of, pending } = useAssessments(recent, 'white', !inert);
  const eco = useEco(!inert);
  const bw = useMemo(() => {
    if (!eco || !stored) return [];
    const all = stored.games.map((g) => ({ game: g, key: gameKey(g) }));
    const names = new Map(all.map((x) => [x.key, openingOf(x.game.m.split(' '), eco)]));
    const fam = (k: string) => {
      const n = names.get(k);
      return n ? familyDe(n) : undefined;
    };
    return (['w', 'b'] as const).map((c) => ({ c, ...bestWorst(openingStats(all, c, fam)) })).filter((x) => x.best || x.worst);
  }, [eco, stored]);
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
            <GameCard key={r.key} row={r} a={of(r.key)} pending={pending > 0} notation={notation} onOpen={() => openGameFromHome(r.key, r.game.c)} />
          ))}
        </ul>
      ) : (
        <p className="hint">Noch keine Partien zu deinen Repertoires.</p>
      )}
      {bw.length > 0 && (
        <button className="rg-foot" onClick={toStats} data-testid="home-opening-bw">
          <span className="rg-lines">
            {bw.map((x) => (
              <span key={x.c}>
                <span className={`kdot ${x.c === 'w' ? 'white' : 'black'}`} aria-label={x.c === 'w' ? 'Mit Weiß' : 'Mit Schwarz'} />
                <BwText best={x.best} worst={x.worst} />
              </span>
            ))}
          </span>
          <span className="link-btn">Statistik</span>
        </button>
      )}
    </section>
  );
}

function BwText({ best, worst }: { best?: OpeningStat; worst?: OpeningStat }) {
  return (
    <>
      {best && (
        <>
          {' '}
          am stärksten: <b className="good">{best.family}</b> {best.score} %
        </>
      )}
      {worst && (
        <>
          {best ? ' · ' : ' '}am schwächsten: <b className="bad">{worst.family}</b> {worst.score} %
        </>
      )}
    </>
  );
}
