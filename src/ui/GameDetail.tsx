// Eine Partie am Brett: Zugleiste eingefärbt (im Repertoire / meine Abweichung / Gegner unvorbereitet / Lücke / danach frei),
// öffnet direkt am entscheidenden Moment, zeigt dort Repertoirezug (grün) und gespielten Zug als Pfeile. Von hier aus geht es
// ins Repertoire (Antwort festlegen), ins Training (diese Stellung) oder zur nächsten Partie der Liste.
import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import type { DrawShape } from 'chessground/draw';
import { displaySan, fenOf, moveNumberPrefix, positionFromFen, START_FEN, stdUci } from '../core/chess';
import { moveNo, plyMarks } from '../core/gameReview';
import { SPEED_NAME } from '../core/opponentStats';
import { nameDe } from '../core/openings';
import { formatEval } from '../core/relevance';
import type { Color } from '../core/types';
import { Board, uciSquares } from './Board';
import { useBackClose } from './backClose';
import { SOURCE_NAME } from './games';
import type { Row } from './gameRows';
import { openInRepertoire, startDrill, STATUS_TEXT } from './GamesView';
import { Icon } from './Icon';
import { useInert } from './inert';
import { engine, toast, useApp } from './store';

interface Step {
  fen: string;
  san?: string;
  uci?: string;
}

/** Stellungen der Partie (Index 0 = Grundstellung, i = nach dem i-ten Halbzug) */
function stepsOf(sans: string[]): Step[] {
  const pos: Chess = positionFromFen(START_FEN);
  const out: Step[] = [{ fen: START_FEN }];
  for (const san of sans) {
    const mv = parseSan(pos, san);
    if (!mv) break;
    const uci = stdUci(pos, mv);
    pos.play(mv);
    out.push({ fen: fenOf(pos), san, uci });
  }
  return out;
}

interface Props {
  rows: Row[];
  index: number;
  color: Color;
  opening: (key: string) => string | undefined;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export function GameDetail({ rows, index, color, opening, onIndex, onClose }: Props) {
  const x = rows[index];
  const { game, rev } = x;
  const notation = useApp((s) => s.settings.ui.notation);
  const cards = useApp((s) => s.cards);
  const inert = useInert();
  useBackClose(true, onClose);
  const steps = useMemo(() => stepsOf(game.m.split(' ').filter(Boolean)), [game.m]);
  const last = steps.length - 1;
  const marks = useMemo(() => plyMarks(rev, last), [rev, last]);
  const eventAt = rev.ply ?? last;
  // Öffnet am entscheidenden Moment: Stellung vor dem Ereignis-Zug
  const [cursor, setCursor] = useState(eventAt);
  const [check, setCheck] = useState<{ rep?: string; played?: string; diff?: number; busy?: boolean }>();
  useEffect(() => {
    setCursor(rev.ply ?? last);
    setCheck(undefined);
  }, [x.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => setCursor(Math.max(0, Math.min(last, i)));
  useEffect(() => {
    if (inert) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(last, c + 1));
      else if (e.key === 'Home') setCursor(0);
      else if (e.key === 'End') setCursor(last);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inert, last]);

  const label = (ply: number, san: string) => moveNumberPrefix(ply) + displaySan(san, notation);
  const step = steps[cursor];
  const atEvent = rev.ply !== undefined && cursor === rev.ply;
  const shapes: DrawShape[] = [];
  if (atEvent && rev.played) {
    const sq = uciSquares(rev.played.uci);
    if (rev.rep) {
      const r = uciSquares(rev.rep.uci);
      if (r) shapes.push({ orig: r[0], dest: r[1], brush: 'mine' });
    }
    if (sq) shapes.push({ orig: sq[0], dest: sq[1], brush: rev.status === 'my-deviation' ? 'wrong' : rev.status === 'opp-new' ? 'opp' : 'eng' });
  }
  const card = rev.keyAt ? cards.get(rev.keyAt) : undefined;
  const ev = cursor > 0 ? game.ev?.[cursor - 1] : undefined;
  const op = opening(x.key);

  const runCheck = async () => {
    if (!rev.fenAt || !rev.rep || !rev.played) return;
    setCheck({ busy: true });
    try {
      const run = (searchmoves: string[]) => engine().analyse(rev.fenAt!, { depth: 14, multipv: 1, searchmoves }, () => {}).done;
      const a = (await run([rev.rep.uci]))?.lines[0];
      const b = (await run([rev.played.uci]))?.lines[0];
      setCheck({
        rep: formatEval(a?.cp, a?.mate),
        played: formatEval(b?.cp, b?.mate),
        diff: a?.cp !== undefined && b?.cp !== undefined ? a.cp - b.cp : undefined,
      });
    } catch {
      setCheck(undefined);
      toast('Stockfish konnte die Stelle nicht prüfen.', 'err');
    }
  };

  // Zugleiste in Zugpaaren
  const pairs: number[][] = [];
  for (let i = 0; i < last; i += 2) pairs.push(i + 1 < last ? [i, i + 1] : [i]);

  return (
    <div className="page game-detail" data-testid="game-detail">
      <header className="gd-head">
        <button className="btn small ghost" onClick={onClose}>
          <Icon name="prev" /> Liste
        </button>
        <div className="gd-title">
          <b>
            <span className={`res r${game.r}`}>{game.r === 1 ? 'Sieg' : game.r === -1 ? 'Niederlage' : 'Remis'}</span> {game.opp ? `gegen ${game.opp}` : 'Partie'}
            {game.or ? <small> ({game.or})</small> : null}
          </b>
          <small className="hint">
            {SOURCE_NAME[game.src ?? 'lichess']}
            {game.sp ? ` · ${SPEED_NAME[game.sp]}` : ''}
            {game.t ? ` · ${new Date(game.t).toLocaleDateString('de-DE')}` : ''}
            {op ? ` · ${nameDe(op)}` : ''}
          </small>
        </div>
        <div className="gd-nav">
          <button className="btn small icon" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Vorige Partie">
            <Icon name="prev" />
          </button>
          <span className="hint">
            {index + 1}/{rows.length}
          </span>
          <button className="btn small icon" disabled={index >= rows.length - 1} onClick={() => onIndex(index + 1)} aria-label="Nächste Partie">
            <Icon name="next" />
          </button>
        </div>
      </header>

      <div className="gd-grid">
        <section className="gd-board">
          <Board fen={step.fen} orientation={color} lastMove={uciSquares(step.uci)} movable="none" shapes={shapes} />
          <div className="board-controls">
            <button className="btn icon" onClick={() => go(0)} aria-label="Zum Anfang">
              <Icon name="first" />
            </button>
            <button className="btn icon" onClick={() => go(cursor - 1)} aria-label="Zug zurück">
              <Icon name="prev" />
            </button>
            <button className="btn icon" onClick={() => go(cursor + 1)} aria-label="Zug vor">
              <Icon name="next" />
            </button>
            {rev.ply !== undefined && (
              <button className="btn small" disabled={atEvent} onClick={() => go(rev.ply!)}>
                Zum Ereignis
              </button>
            )}
            {ev !== undefined && <span className="hint gd-eval">{formatEval(ev, undefined)}</span>}
          </div>
        </section>

        <section className="gd-side">
          <div className={`card gd-event st-${rev.status}`} data-testid="gd-event">
            <b>{STATUS_TEXT[rev.status]}</b>
            {rev.ply !== undefined && rev.played ? (
              <p>
                {rev.status === 'my-deviation' && (
                  <>
                    Zug {moveNo(rev.ply)}: Du hast <b className="bad">{label(rev.ply, rev.played.san)}</b> gespielt – dein Repertoire sieht{' '}
                    <b className="me">{label(rev.ply, rev.rep!.san)}</b> vor.
                  </>
                )}
                {rev.status === 'opp-new' && (
                  <>
                    Zug {moveNo(rev.ply)}: Dein Gegner spielte <b className="opp">{label(rev.ply, rev.played.san)}</b> – darauf hast du noch keine Antwort vorbereitet.
                  </>
                )}
                {rev.status === 'hole' && (
                  <>
                    Zug {moveNo(rev.ply)}: Hier hattest du noch keinen Zug festgelegt (gespielt: {label(rev.ply, rev.played.san)}).
                  </>
                )}
                {rev.status === 'end' && <>Ab Zug {moveNo(rev.ply)} bewusst frei gespielt (Ende-Marker).</>}
              </p>
            ) : (
              <p>Die ganze Eröffnung (bis Zug {moveNo(Math.max(0, last - 1))}) lief in deinem Repertoire.</p>
            )}
            {rev.mistake && (
              <p>
                <b className="bad">Fehler</b> – {label(rev.mistake.ply, rev.mistake.san)} verliert ca. {(rev.mistake.drop / 100).toFixed(1).replace('.', ',')} Bauern.{' '}
                <button className="link-btn" onClick={() => go(rev.mistake!.ply)}>
                  Hinspringen
                </button>
              </p>
            )}
            {check && !check.busy && check.rep && (
              <p>
                Stockfish: Repertoirezug <b>{check.rep}</b>, gespielter Zug <b>{check.played}</b>
                {check.diff !== undefined && check.diff >= 100 && <b className="bad"> – das war ein Fehler</b>}
                {check.diff !== undefined && check.diff < 30 && <> – gleichwertig</>}
              </p>
            )}
            <div className="row-actions">
              {rev.status === 'my-deviation' && card && !card.suspended && (
                <button
                  className="btn small primary"
                  onClick={() => startDrill([{ cardId: card.id, posKey: card.posKey, path: rev.prefix, priority: 1 }])}
                >
                  <Icon name="train" /> Diese Stellung trainieren
                </button>
              )}
              {rev.status === 'opp-new' && (
                <button className="btn small primary" onClick={() => openInRepertoire(rev.prefix, rev.played!.uci)}>
                  Antwort festlegen
                </button>
              )}
              {rev.status === 'hole' && (
                <button className="btn small primary" onClick={() => openInRepertoire(rev.prefix)}>
                  Zug festlegen
                </button>
              )}
              {(rev.status === 'my-deviation' || rev.status === 'end') && (
                <button className="btn small" onClick={() => openInRepertoire(rev.prefix, rev.played!.uci)}>
                  Im Repertoire öffnen
                </button>
              )}
              {rev.status === 'my-deviation' && !game.ev && (
                <button className="btn small ghost" disabled={check?.busy} onClick={() => void runCheck()}>
                  {check?.busy ? 'Prüfe …' : 'Mit Stockfish prüfen'}
                </button>
              )}
              {game.url && (
                <a className="btn small ghost" href={game.url} target="_blank" rel="noreferrer noopener">
                  Ganze Partie <Icon name="next" />
                </a>
              )}
            </div>
          </div>

          <div className="card gd-moves" aria-label="Züge">
            <ol>
              {pairs.map((p) => (
                <li key={p[0]}>
                  <span className="mvno">{moveNo(p[0])}.</span>
                  {p.map((i) => (
                    <button
                      key={i}
                      className={`mv ${marks[i]} ${cursor === i + 1 ? 'cur' : ''} ${rev.mistake?.ply === i ? 'mistake' : ''}`}
                      aria-current={cursor === i + 1 ? 'true' : undefined}
                      onClick={() => go(i + 1)}
                    >
                      {displaySan(steps[i + 1].san!, notation)}
                    </button>
                  ))}
                </li>
              ))}
            </ol>
            <p className="gd-legend">
              <span>
                <i className="rep" /> Repertoire
              </span>
              <span>
                <i className="dev" /> deine Abweichung
              </span>
              <span>
                <i className="opp" /> Gegner neu
              </span>
              <span>
                <i className="out" /> frei
              </span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
