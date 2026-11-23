// Kompakte Partie-Karte (Startseite „Letzte Partien“, Partien „Zu prüfen“): Ergebnis, Gegner, was passiert ist,
// wie du danach standest – und rechts ein kleines Brett mit der Stellung und dem Zug der Abweichung.
import { useMemo, type ReactNode } from 'react';
import type { DrawShape } from 'chessground/draw';
import { displaySan, moveNumberPrefix } from '../core/chess';
import { moveNo, type Assessment, type GameReview } from '../core/gameReview';
import { SPEED_NAME } from '../core/opponentStats';
import type { Color } from '../core/types';
import { Board, uciSquares } from './Board';
import { fenAfter, fmtCp } from './gameEvals';
import type { Row } from './gameRows';

/** Ein Satz: was ist passiert (für Karten) */
export function shortStatus(rev: GameReview, label: (ply: number, san: string) => string): string {
  if (rev.ply === undefined || !rev.played) return 'Ganz im Repertoire';
  const z = `Zug ${moveNo(rev.ply)}: `;
  switch (rev.status) {
    case 'my-deviation':
      return `${z}du ${label(rev.ply, rev.played.san)} statt ${label(rev.ply, rev.rep!.san)}`;
    case 'opp-new':
      return `${z}Gegner ${label(rev.ply, rev.played.san)} – nicht vorbereitet`;
    case 'hole':
      return `${z}kein Zug festgelegt (gespielt ${label(rev.ply, rev.played.san)})`;
    case 'end':
      return `Ab Zug ${moveNo(rev.ply)} frei gespielt (Ende-Marker)`;
    default:
      return 'Ganz im Repertoire';
  }
}

/** Bewertungs-Plakette: „−0,8 · Abgewichen – danach schlechter“ */
export function VerdictBadge({ a, pending }: { a?: Assessment; pending?: boolean }) {
  if (!a) return pending ? <span className="verdict wait">Stockfish bewertet …</span> : null;
  return (
    <span className={`verdict ${a.verdict}`} title="Bewertung nach dem Zug der Abweichung, aus deiner Sicht">
      <b>{fmtCp(a.cp)}</b> {a.label}
    </span>
  );
}

/** Kleines Brett: Stellung vor dem Ereignis-Zug, gespielter Zug (rot/orange) und Repertoirezug (grün) als Pfeile */
export function MiniBoard({ rev, sans, color }: { rev: GameReview; sans: string[]; color: Color }) {
  const fen = useMemo(() => rev.fenAt ?? fenAfter(sans, Math.min(rev.inRepPlies, sans.length)) ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [rev, sans]);
  const shapes: DrawShape[] = [];
  const rep = uciSquares(rev.rep?.uci);
  if (rep) shapes.push({ orig: rep[0], dest: rep[1], brush: 'mine' });
  const pl = uciSquares(rev.played?.uci);
  if (pl && rev.status !== 'end') shapes.push({ orig: pl[0], dest: pl[1], brush: rev.status === 'my-deviation' ? 'wrong' : 'opp' });
  return (
    <div className="mini-board" aria-hidden>
      <Board fen={fen} orientation={color} movable="none" shapes={shapes} coords={false} animationMs={0} />
    </div>
  );
}

export function GameCard({
  row,
  a,
  pending,
  color,
  notation,
  onOpen,
  actions,
}: {
  row: Row;
  a?: Assessment;
  pending?: boolean;
  color: Color;
  notation: 'de' | 'en';
  onOpen: () => void;
  actions?: ReactNode;
}) {
  const { game, rev } = row;
  const sans = useMemo(() => game.m.split(' ').filter(Boolean), [game.m]);
  const label = (ply: number, san: string) => moveNumberPrefix(ply) + displaySan(san, notation);
  return (
    <li className={`game-card ${a?.verdict ?? ''} st-${rev.status}`}>
      <button className="gc-main" onClick={onOpen} aria-label={`Partie gegen ${game.opp ?? 'Gegner'} ansehen`}>
        <span className="gc-text">
          <span className="gc-head">
            <span className={`res r${game.r}`}>{game.r === 1 ? 'Sieg' : game.r === -1 ? 'Niederlage' : 'Remis'}</span>
            <b className="gc-opp">{game.opp ?? 'Partie'}</b>
          </span>
          <small className="hint">
            {game.t ? new Date(game.t).toLocaleDateString('de-DE') : ''}
            {game.sp ? ` · ${SPEED_NAME[game.sp]}` : ''}
          </small>
          <span className={`gc-status ${rev.status}`}>{shortStatus(rev, label)}</span>
          <VerdictBadge a={a} pending={pending} />
        </span>
        <MiniBoard rev={rev} sans={sans} color={color} />
      </button>
      {actions && <div className="gc-actions">{actions}</div>}
    </li>
  );
}
