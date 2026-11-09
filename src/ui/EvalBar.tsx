// Bewertungsbalken links neben dem Brett (wie bei chess.com/lichess): Weiß-Anteil nach Gewinnchance,
// Zahl am Ende der besseren Seite. Bewertung immer aus Sicht von Weiß; der Balken dreht sich mit dem Brett.
// Beim Weiterklicken bleibt der letzte Wert stehen, bis die neue Stellung bewertet ist (kein Springen auf 0).
import { useEffect, useState } from 'react';
import { turnOf } from '../core/chess';
import { formatEval } from '../core/relevance';
import type { Color, EngineLine } from '../core/types';

interface Score {
  cp?: number;
  mate?: number;
}

/** Anteil Weiß in Prozent (Gewinnchancen-Kurve wie bei lichess). */
export function whiteShare(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 100 : s.mate < 0 ? 0 : 50;
  if (s.cp === undefined) return 50;
  const wc = 2 / (1 + Math.exp(-0.00368208 * s.cp)) - 1;
  return Math.min(96, Math.max(4, 50 + 50 * wc));
}

/** Kurzform für den schmalen Balken: „0,3“, „12“, „M3“. */
export function barLabel(s: Score): string {
  if (s.mate !== undefined) return `M${Math.abs(s.mate)}`;
  if (s.cp === undefined) return '';
  const v = Math.abs(s.cp) / 100;
  return (v < 10 ? v.toFixed(1) : v.toFixed(0)).replace('.', ',');
}

export function EvalBar({ fen, lines, depth, orientation }: { fen: string; lines: EngineLine[]; depth: number; orientation: Color }) {
  const [score, setScore] = useState<Score | undefined>();
  const top = lines[0];
  useEffect(() => {
    if (!top || !fen) return;
    const s = turnOf(fen) === 'white' ? 1 : -1; // Engine bewertet aus Sicht der Seite am Zug
    setScore({ cp: top.cp !== undefined ? top.cp * s : undefined, mate: top.mate !== undefined ? top.mate * s : undefined });
  }, [top, fen]);

  const share = score ? whiteShare(score) : 50;
  const whiteBetter = share >= 50;
  return (
    <div
      className={`evalbar ${orientation === 'black' ? 'flip' : ''} ${score ? '' : 'loading'}`}
      role="img"
      aria-label={score ? `Bewertung ${formatEval(score.cp, score.mate)} aus Sicht von Weiß, Tiefe ${depth}` : 'Bewertung wird berechnet'}
      title={score ? `Stockfish: ${formatEval(score.cp, score.mate)} (Tiefe ${depth})` : 'Stockfish rechnet …'}
    >
      <i className="evalbar-white" style={{ height: `${share}%` }} />
      {score && <span className={`evalbar-num ${whiteBetter ? 'w' : 'b'}`}>{barLabel(score)}</span>}
    </div>
  );
}
