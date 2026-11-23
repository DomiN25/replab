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

// ---------------------------------------------------------------------------------------------------------------------
// Auswertung über mehrere Partien (Partien-Seite, Lücken „aus deinen Partien“)

/** Einfärbung je Halbzug für die Zugleiste: im Repertoire, Ereignis (Abweichung/Gegner neu/Lücke/Ende) oder danach frei. */
export type PlyMark = 'rep' | 'dev' | 'opp' | 'hole' | 'end' | 'out';

const MARK_OF: Record<Exclude<ReviewStatus, 'in-rep'>, PlyMark> = { 'my-deviation': 'dev', 'opp-new': 'opp', hole: 'hole', end: 'end' };

export function plyMarks(rev: GameReview, len: number): PlyMark[] {
  const out: PlyMark[] = [];
  for (let i = 0; i < len; i++) {
    if (rev.status === 'in-rep' || rev.ply === undefined) out.push(i < rev.inRepPlies ? 'rep' : 'out');
    else out.push(i < rev.ply ? 'rep' : i === rev.ply ? MARK_OF[rev.status] : 'out');
  }
  return out;
}

export interface Reviewed {
  game: GameRec;
  rev: GameReview;
}

export interface ReviewSummary {
  games: number;
  count: Record<ReviewStatus, number>;
  /** Punkte in Prozent (Sieg 1, Remis ½) je Ausgang; undefined ohne Partien */
  score: Partial<Record<ReviewStatus, number>>;
  /** Gesamtpunkte in Prozent */
  total?: number;
  /** durchschnittliche Zugnummer (volle Züge) des Ereignisses */
  avgMove: { dev?: number; opp?: number; hole?: number };
  /** Median: bis zu welchem Zug (volle Züge) die Partie in der Vorbereitung blieb */
  heldMove?: number;
  mistakes: number;
}

/** Halbzug-Index → Zugnummer (0 → 1, 1 → 1, 2 → 2 …) */
export const moveNo = (ply: number) => Math.floor(ply / 2) + 1;

export function summarize(items: Reviewed[]): ReviewSummary {
  const count: Record<ReviewStatus, number> = { 'in-rep': 0, 'my-deviation': 0, 'opp-new': 0, hole: 0, end: 0 };
  const pts: Partial<Record<ReviewStatus, number>> = {};
  const plies: Record<'dev' | 'opp' | 'hole', number[]> = { dev: [], opp: [], hole: [] };
  const held: number[] = [];
  let mistakes = 0;
  let all = 0;
  for (const { game, rev } of items) {
    count[rev.status]++;
    const p = (game.r + 1) / 2;
    pts[rev.status] = (pts[rev.status] ?? 0) + p;
    all += p;
    if (rev.mistake) mistakes++;
    held.push(rev.inRepPlies);
    if (rev.ply !== undefined) {
      if (rev.status === 'my-deviation') plies.dev.push(rev.ply);
      else if (rev.status === 'opp-new') plies.opp.push(rev.ply);
      else if (rev.status === 'hole') plies.hole.push(rev.ply);
    }
  }
  const score: Partial<Record<ReviewStatus, number>> = {};
  for (const k of Object.keys(count) as ReviewStatus[]) if (count[k]) score[k] = Math.round((100 * (pts[k] ?? 0)) / count[k]);
  const avg = (a: number[]) => (a.length ? Math.round((10 * a.reduce((s, x) => s + moveNo(x), 0)) / a.length) / 10 : undefined);
  held.sort((a, b) => a - b);
  // inRepPlies = Anzahl Halbzüge im Repertoire → letzter Zug in der Vorbereitung
  const med = held.length ? held[Math.floor((held.length - 1) / 2)] : undefined;
  return {
    games: items.length,
    count,
    score,
    total: items.length ? Math.round((100 * all) / items.length) : undefined,
    avgMove: { dev: avg(plies.dev), opp: avg(plies.opp), hole: avg(plies.hole) },
    heldMove: med === undefined ? undefined : med === 0 ? 0 : moveNo(med - 1),
    mistakes,
  };
}

export interface Hotspot {
  kind: 'dev' | 'opp' | 'hole';
  keyAt: string;
  ply: number;
  /** Weg bis vor den Ereignis-Halbzug (aus der ersten Partie) */
  prefix: string[];
  played: { uci: string; san: string };
  rep?: { uci: string; san: string };
  n: number;
  /** Punkte in Prozent in diesen Partien */
  score: number;
  /** Indizes der Partien in der übergebenen Liste */
  idx: number[];
}

/** Wiederkehrende Brennpunkte: gleiche Stellung + gleicher gespielter Zug, nach Häufigkeit (dann früher Zug zuerst). */
export function hotspots(items: Reviewed[], max = 6): Hotspot[] {
  const m = new Map<string, Hotspot & { pts: number }>();
  items.forEach(({ game, rev }, i) => {
    const kind = rev.status === 'my-deviation' ? 'dev' : rev.status === 'opp-new' ? 'opp' : rev.status === 'hole' ? 'hole' : undefined;
    if (!kind || !rev.keyAt || !rev.played || rev.ply === undefined) return;
    const k = `${kind}|${rev.keyAt}|${rev.played.uci}`;
    const cur = m.get(k);
    const p = (game.r + 1) / 2;
    if (cur) {
      cur.n++;
      cur.pts += p;
      cur.idx.push(i);
    } else m.set(k, { kind, keyAt: rev.keyAt, ply: rev.ply, prefix: rev.prefix, played: rev.played, rep: rev.rep, n: 1, pts: p, score: 0, idx: [i] });
  });
  return [...m.values()]
    .map(({ pts, ...h }) => ({ ...h, score: Math.round((100 * pts) / h.n) }))
    .sort((a, b) => b.n - a.n || a.ply - b.ply)
    .slice(0, max);
}

/** Eröffnungsname der Partie: tiefste Stellung mit Namen (Tabelle posKey → Lichess-Name). */
export function openingOf(sans: string[], eco: Record<string, string>): string | undefined {
  let pos: Chess = positionFromFen(START_FEN);
  let name: string | undefined;
  for (const san of sans) {
    const mv = parseSan(pos, san);
    if (!mv) break;
    pos.play(mv);
    name = eco[posKeyOf(pos)] ?? name;
  }
  return name;
}
