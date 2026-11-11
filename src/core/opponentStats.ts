// Eigene Partien auswerten: Was spielen Gegner in meinen Repertoire-Stellungen gegen mich, was spiele ich selbst?
// Reine Logik, UI-frei (Laden der Partien: services/lichessGames.ts, Speicher: ui/games.ts).
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { posKeyOf, positionFromFen, START_FEN, stdUci } from './chess';
import type { Color } from './types';

/** Nur die Eröffnung zählt: so viele Halbzüge pro Partie werden gespeichert und ausgewertet. */
export const MAX_PLIES = 30;

export interface GameRec {
  /** meine Farbe in der Partie */
  c: 'w' | 'b';
  /** Ergebnis aus meiner Sicht: 1 Sieg, 0 Remis, −1 Niederlage */
  r: 1 | 0 | -1;
  /** SAN-Züge, durch Leerzeichen getrennt (höchstens MAX_PLIES) */
  m: string;
  /** Zeitpunkt (ms) */
  t?: number;
}

export interface ReplyStat {
  uci: string;
  san: string;
  n: number;
  win: number;
  draw: number;
  loss: number;
}

export interface OppStats {
  /** ausgewertete Partien dieser Farbe */
  games: number;
  /** Stellung (posKey) vor dem Gegnerzug → was der Gegner dort gespielt hat (häufigste zuerst) */
  replies: Map<string, ReplyStat[]>;
  /** Stellung vor meinem Zug → was ich dort gespielt habe (häufigste zuerst) */
  mine: Map<string, ReplyStat[]>;
}

function add(map: Map<string, Map<string, ReplyStat>>, key: string, uci: string, san: string, r: 1 | 0 | -1) {
  let inner = map.get(key);
  if (!inner) map.set(key, (inner = new Map()));
  let s = inner.get(uci);
  if (!s) inner.set(uci, (s = { uci, san, n: 0, win: 0, draw: 0, loss: 0 }));
  s.n++;
  if (r === 1) s.win++;
  else if (r === 0) s.draw++;
  else s.loss++;
}

const sorted = (m: Map<string, Map<string, ReplyStat>>) =>
  new Map([...m].map(([k, v]) => [k, [...v.values()].sort((a, b) => b.n - a.n || a.san.localeCompare(b.san))]));

/** Statistik über alle Partien, in denen ich `color` gespielt habe. Unlesbare Züge beenden die jeweilige Partie. */
export function buildOppStats(games: GameRec[], color: Color): OppStats {
  const mine = new Map<string, Map<string, ReplyStat>>();
  const opp = new Map<string, Map<string, ReplyStat>>();
  const want = color === 'white' ? 'w' : 'b';
  let count = 0;
  for (const g of games) {
    if (g.c !== want) continue;
    count++;
    let pos: Chess = positionFromFen(START_FEN);
    for (const san of g.m.split(' ').slice(0, MAX_PLIES)) {
      if (!san) break;
      const mv = parseSan(pos, san);
      if (!mv) break;
      const key = posKeyOf(pos);
      add(pos.turn === color ? mine : opp, key, stdUci(pos, mv), san, g.r);
      pos.play(mv);
    }
  }
  return { games: count, replies: sorted(opp), mine: sorted(mine) };
}

/** Wie oft kam der Zug `uci` in der Stellung `posKey` (vor dem Gegnerzug) in meinen Partien vor? */
export function gamesWith(stats: OppStats | undefined, posKey: string, uci: string): number {
  return stats?.replies.get(posKey)?.find((r) => r.uci === uci)?.n ?? 0;
}
