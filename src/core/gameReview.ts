// Partien gegen das Repertoire prüfen: Wo bin ich abgewichen, wo hat der Gegner etwas gespielt, das nicht vorbereitet ist,
// und (bei Lichess-Analyse) wo habe ich in der Eröffnung einen Fehler gemacht? (UI-frei, getestet)
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { posKeyOf, positionFromFen, START_FEN, stdUci } from './chess';
import { MAX_PLIES, type GameRec } from './opponentStats';
import type { Color } from './types';

/** Zugriff aufs Repertoire (unabhängig von Graph/Store, damit testbar). */
export interface RepView {
  /** mein Repertoirezug in dieser Stellung */
  myMove: (posKey: string) => { uci: string; san: string } | undefined;
  /** Stellung ist im Repertoire-Baum bekannt (Gegnerzug war vorbereitet oder als Lücke erfasst) */
  known: (posKey: string) => boolean;
  /** Ende-Marker: ab hier improvisiere ich bewusst */
  isEnd: (posKey: string) => boolean;
}

export type ReviewStatus =
  | 'in-rep' // die ganze ausgewertete Eröffnung lief im Repertoire
  | 'my-deviation' // ich habe einen anderen Zug gespielt als mein Repertoirezug
  | 'opp-new' // der Gegner hat etwas gespielt, das nicht im Repertoire-Baum steht
  | 'hole' // Stellung erreicht, in der ich noch keinen Zug festgelegt habe (Lücke)
  | 'end'; // Ende-Marker erreicht (geplante Improvisation)

export interface Mistake {
  /** Halbzug-Index (0 = erster Zug der Partie) */
  ply: number;
  san: string;
  /** Verlust in cp aus meiner Sicht (> 0) */
  drop: number;
}

export interface GameReview {
  status: ReviewStatus;
  /** Halbzug-Index, an dem das Ereignis eintrat (Abweichung bzw. erster unbekannter Gegnerzug / Lücke) */
  ply?: number;
  /** Anzahl Halbzüge, die noch im Repertoire waren */
  inRepPlies: number;
  /** Stellung (posKey und FEN) vor dem Ereignis-Halbzug */
  fenAt?: string;
  keyAt?: string;
  /** mein Repertoirezug (nur bei my-deviation) */
  rep?: { uci: string; san: string };
  /** der tatsächlich gespielte Zug an dieser Stelle */
  played?: { uci: string; san: string };
  /** UCI-Züge bis vor den Ereignis-Halbzug */
  prefix: string[];
  /** erster grober Fehler von mir in der Eröffnung (nur mit Lichess-Bewertungen) */
  mistake?: Mistake;
}

/** Ab diesem Verlust (cp) gilt ein Zug als Fehler. */
export const MISTAKE_CP = 150;

/** Erster eigener Zug mit Bewertungsverlust ≥ minDrop (ev = cp aus Weiß-Sicht nach jedem Halbzug). */
export function findMistake(ev: number[] | undefined, sans: string[], color: Color, minDrop = MISTAKE_CP): Mistake | undefined {
  if (!ev?.length) return undefined;
  const mine = color === 'white' ? 0 : 1;
  const sign = color === 'white' ? 1 : -1;
  for (let i = 0; i < Math.min(ev.length, sans.length); i++) {
    if (i % 2 !== mine) continue;
    const before = i === 0 ? 20 : ev[i - 1];
    const drop = (before - ev[i]) * sign;
    if (drop >= minDrop) return { ply: i, san: sans[i], drop };
  }
  return undefined;
}

export function reviewGame(game: GameRec, color: Color, rep: RepView): GameReview {
  const sans = game.m.split(' ').filter(Boolean).slice(0, MAX_PLIES);
  const mistake = findMistake(game.ev, sans, color);
  let pos: Chess = positionFromFen(START_FEN);
  const prefix: string[] = [];
  const res = (r: Omit<GameReview, 'prefix' | 'mistake'>): GameReview => ({ ...r, prefix, mistake });
  for (let i = 0; i < sans.length; i++) {
    const mv = parseSan(pos, sans[i]);
    if (!mv) break;
    const key = posKeyOf(pos);
    const fen = fenOfPos(pos);
    const uci = stdUci(pos, mv);
    if (pos.turn === color) {
      if (rep.isEnd(key)) return res({ status: 'end', ply: i, inRepPlies: i, fenAt: fen, keyAt: key, played: { uci, san: sans[i] } });
      const mine = rep.myMove(key);
      if (!mine) return res({ status: 'hole', ply: i, inRepPlies: i, fenAt: fen, keyAt: key, played: { uci, san: sans[i] } });
      if (mine.uci !== uci) return res({ status: 'my-deviation', ply: i, inRepPlies: i, fenAt: fen, keyAt: key, rep: mine, played: { uci, san: sans[i] } });
    }
    prefix.push(uci);
    pos.play(mv);
    if (pos.turn === color && !rep.known(posKeyOf(pos))) {
      // Gegner hat gezogen und die neue Stellung kennt das Repertoire nicht; der Weg endet vor dem Gegnerzug
      prefix.pop();
      return res({ status: 'opp-new', ply: i, inRepPlies: i, fenAt: fen, keyAt: key, played: { uci, san: sans[i] } });
    }
  }
  return res({ status: 'in-rep', inRepPlies: sans.length });
}

function fenOfPos(pos: Chess): string {
  return `${posKeyOf(pos)} 0 1`;
}
