// Partien: meine geladenen Partien (Lichess/Chess.com) gegen das Repertoire prüfen – wo bin ich abgewichen, wo hat der Gegner
// Unvorbereitetes gespielt, wo ist ein Fehler passiert? Antippen öffnet die Stelle im Repertoire.
import { useDeferredValue, useMemo, useState } from 'react';
import { displaySan, formatLine, moveNumberPrefix } from '../core/chess';
import { reviewGame, type GameReview, type RepView, type ReviewStatus } from '../core/gameReview';
import type { GameRec } from '../core/opponentStats';
import { formatEval } from '../core/relevance';
import { engine, currentRep, lineFromUcis, setLine, setView, toast, useApp } from './store';
import { SOURCE_NAME, useMyGames } from './games';
import { Icon } from './Icon';

type Filter = 'all' | 'dev' | 'opp' | 'hole' | 'mistake';
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'Alle' },
  { k: 'dev', label: 'Meine Abweichungen' },
  { k: 'opp', label: 'Unvorbereitet' },
  { k: 'hole', label: 'Lücken' },
  { k: 'mistake', label: 'Fehler' },
];

interface Row {
  game: GameRec;
  rev: GameReview;
  key: string;
}

interface Check {
  repCp?: number;
  repMate?: number;
  playedCp?: number;
  playedMate?: number;
  busy?: boolean;
}

const STATUS_TEXT: Record<ReviewStatus, string> = {
  'in-rep': 'Ganz im Repertoire',
  'my-deviation': 'Du bist abgewichen',
  'opp-new': 'Gegner unvorbereitet',
  hole: 'Lücke: noch kein Zug',
  end: 'Ende-Marker erreicht',
};

/** Zugfolge (SAN) bis vor den Ereignis-Halbzug */
function lineSans(r: GameReview): string[] {
  try {
    return lineFromUcis(r.prefix)
      .slice(1)
      .map((s) => s.san!);
  } catch {
    return [];
  }
}

export function Games() {
  const stored = useMyGames();
  const rep = currentRep();
  const moves = useApp((s) => s.moves);
  const marks = useApp((s) => s.marks);
  const graph = useApp((s) => s.graph);
  const notation = useApp((s) => s.settings.ui.notation);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(40);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const color = rep?.color ?? 'white';

  const view: RepView = useMemo(
    () => ({
      myMove: (k) => {
        const m = moves.get(k);
        return m ? { uci: m.uci, san: m.san } : undefined;
      },
      known: (k) => !!graph?.byPosKey.has(k),
      isEnd: (k) => !!marks.get(k)?.endOfLine,
    }),
    [moves, marks, graph],
  );
  const mine = useMemo(() => (stored?.games ?? []).filter((g) => g.c === (color === 'white' ? 'w' : 'b')), [stored, color]);
  const deferred = useDeferredValue(mine);
  const rows: Row[] = useMemo(
    () => deferred.map((g, i) => ({ game: g, rev: reviewGame(g, color, view), key: g.id ?? `${g.src ?? 'l'}${i}` })),
    [deferred, color, view],
  );

  const count = (s: ReviewStatus) => rows.filter((r) => r.rev.status === s).length;
  const mistakes = rows.filter((r) => r.rev.mistake).length;
  const filtered = rows.filter((r) =>
    filter === 'all'
      ? true
      : filter === 'dev'
        ? r.rev.status === 'my-deviation'
        : filter === 'opp'
          ? r.rev.status === 'opp-new'
          : filter === 'hole'
            ? r.rev.status === 'hole'
            : !!r.rev.mistake,
  );
  // häufigste eigene Abweichungen (gleiche Stellung, gleicher gespielter Zug)
  const top = useMemo(() => {
    const m = new Map<string, { n: number; r: GameReview }>();
    for (const x of rows) {
      if (x.rev.status !== 'my-deviation') continue;
      const k = `${x.rev.keyAt}|${x.rev.played!.uci}`;
      const cur = m.get(k);
      if (cur) cur.n++;
      else m.set(k, { n: 1, r: x.rev });
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  }, [rows]);

  const sanLabel = (ply: number, san: string) => moveNumberPrefix(ply) + displaySan(san, notation);

  /** Stelle im Repertoire öffnen: Weg der Partie bis zum Ereignis (bei Abweichung/Unvorbereitetem inkl. gespieltem Zug) */
  const open = (r: GameReview) => {
    const ucis = r.status === 'my-deviation' || r.status === 'opp-new' ? [...r.prefix, r.played!.uci] : r.prefix;
    try {
      setLine(lineFromUcis(ucis));
      setView('build');
    } catch {
      toast('Diese Partie lässt sich nicht öffnen.', 'err');
    }
  };

  /** Stockfish: Repertoirezug gegen gespielten Zug an der Abweichung (lokal, flach genug für das Handy) */
  const check = async (x: Row) => {
    const r = x.rev;
    if (!r.fenAt || !r.rep || !r.played) return;
    setChecks((c) => ({ ...c, [x.key]: { busy: true } }));
    try {
      const run = (searchmoves: string[]) => engine().analyse(r.fenAt!, { depth: 14, multipv: 1, searchmoves }, () => {}).done;
      const a = await run([r.rep.uci]);
      const b = await run([r.played.uci]);
      setChecks((c) => ({
        ...c,
        [x.key]: { repCp: a?.lines[0]?.cp, repMate: a?.lines[0]?.mate, playedCp: b?.lines[0]?.cp, playedMate: b?.lines[0]?.mate },
      }));
    } catch {
      setChecks((c) => ({ ...c, [x.key]: {} }));
      toast('Stockfish konnte die Stelle nicht prüfen.', 'err');
    }
  };

  if (!stored?.games.length)
    return (
      <div className="page games-page">
        <header className="page-head">
          <h1>Partien</h1>
        </header>
        <div className="empty card empty-cta">
          <Icon name="clock" />
          <p>Noch keine Partien geladen. Gib in den Einstellungen deinen Lichess- oder Chess.com-Namen ein.</p>
          <div className="row-actions center">
            <button className="btn primary" onClick={() => setView('settings')}>
              Zu den Einstellungen
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page games-page" data-testid="games-page">
      <header className="page-head">
        <h1>
          Partien <span className="count">{mine.length}</span>
        </h1>
        <div className="tools">
          <button className="btn small ghost" onClick={() => setView('settings')}>
            Quellen &amp; Laden
          </button>
        </div>
      </header>
      <p className="hint">
        Gegen dein Repertoire „{rep?.name}“ ({color === 'white' ? 'Weiß' : 'Schwarz'}), {rows.length} {rows.length === 1 ? 'Partie' : 'Partien'} mit dieser Farbe.
      </p>
      <div className="games-sum" data-testid="games-sum">
        <span className="gs ok">
          <b>{count('in-rep') + count('end')}</b> im Repertoire
        </span>
        <span className="gs dev">
          <b>{count('my-deviation')}</b> eigene Abweichung
        </span>
        <span className="gs opp">
          <b>{count('opp-new')}</b> Gegner unvorbereitet
        </span>
        <span className="gs hole">
          <b>{count('hole')}</b> Lücke
        </span>
        {mistakes > 0 && (
          <span className="gs bad">
            <b>{mistakes}</b> Fehler
          </span>
        )}
      </div>
      {top.length > 0 && (
        <div className="card games-top">
          <b>Häufigste Abweichungen</b>
          {top.map(({ n, r }) => (
            <button key={`${r.keyAt}|${r.played!.uci}`} className="link-btn" onClick={() => open(r)}>
              {n}× nach {formatLine(lineSans(r), notation) || 'Start'}: {sanLabel(r.ply!, r.played!.san)} statt {sanLabel(r.ply!, r.rep!.san)}
            </button>
          ))}
        </div>
      )}
      <div className="seg small games-filter" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            aria-pressed={filter === f.k}
            onClick={() => {
              setFilter(f.k);
              setLimit(40);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className="games-list">
        {filtered.slice(0, limit).map((x) => {
          const r = x.rev;
          const sans = x.game.m.split(' ');
          const shown = r.ply !== undefined ? sans.slice(0, r.ply + 1) : sans.slice(0, 12);
          const ck = checks[x.key];
          return (
            <li key={x.key} className={`game-row st-${r.status}`}>
              <div className="game-head">
                <span className={`res r${x.game.r}`}>{x.game.r === 1 ? 'Sieg' : x.game.r === -1 ? 'Niederlage' : 'Remis'}</span>
                <span className="game-opp">{x.game.opp ? `gegen ${x.game.opp}` : 'Partie'}</span>
                <small className="hint">
                  {SOURCE_NAME[x.game.src ?? 'lichess']}
                  {x.game.t ? ` · ${new Date(x.game.t).toLocaleDateString('de-DE')}` : ''}
                </small>
                {x.game.url && (
                  <a className="game-link" href={x.game.url} target="_blank" rel="noreferrer noopener" aria-label="Partie im Browser öffnen" title="Partie öffnen">
                    <Icon name="next" />
                  </a>
                )}
              </div>
              <p className="game-line">{formatLine(shown, notation)}</p>
              <p className={`game-status ${r.status}`}>
                <b>{STATUS_TEXT[r.status]}</b>
                {r.status === 'my-deviation' && (
                  <>
                    {' '}
                    – {sanLabel(r.ply!, r.played!.san)} statt <b className="me">{sanLabel(r.ply!, r.rep!.san)}</b>
                  </>
                )}
                {r.status === 'opp-new' && <> – {sanLabel(r.ply!, r.played!.san)} kommt in deinem Repertoire nicht vor</>}
                {r.status === 'hole' && <> – bei {sanLabel(r.ply!, r.played!.san)} hattest du keinen festgelegten Zug</>}
                {r.status === 'end' && <> – ab {sanLabel(r.ply!, r.played!.san)} frei gespielt</>}
              </p>
              {r.mistake && (
                <p className="game-status bad">
                  <b>Fehler</b> – {sanLabel(r.mistake.ply, r.mistake.san)} verliert ca. {(r.mistake.drop / 100).toFixed(1).replace('.', ',')} Bauern (Lichess-Analyse)
                </p>
              )}
              {ck && !ck.busy && (ck.repCp !== undefined || ck.repMate !== undefined) && (
                <p className="game-status">
                  Stockfish: Repertoirezug <b>{formatEval(ck.repCp, ck.repMate)}</b>, gespielter Zug <b>{formatEval(ck.playedCp, ck.playedMate)}</b>
                  {ck.repCp !== undefined && ck.playedCp !== undefined && ck.repCp - ck.playedCp >= 100 && <b className="bad"> – das war ein Fehler</b>}
                  {ck.repCp !== undefined && ck.playedCp !== undefined && ck.repCp - ck.playedCp < 30 && <> – gleichwertig</>}
                </p>
              )}
              <div className="row-actions">
                <button className="btn small" onClick={() => open(r)} disabled={r.status === 'in-rep'}>
                  Im Repertoire öffnen
                </button>
                {r.status === 'my-deviation' && !x.game.ev && (
                  <button className="btn small ghost" disabled={ck?.busy} onClick={() => void check(x)}>
                    {ck?.busy ? 'Prüfe …' : 'Mit Stockfish prüfen'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!filtered.length && <p className="hint">Keine Partien in dieser Auswahl.</p>}
      {filtered.length > limit && (
        <button className="btn small ghost" onClick={() => setLimit((l) => l + 40)}>
          Weitere {Math.min(40, filtered.length - limit)} anzeigen
        </button>
      )}
    </div>
  );
}
