// Schach-Hilfsfunktionen auf Basis von chessops: posKey, Zugausführung, UCI/SAN, deutsche Notation.
import { Chess, castlingSide, normalizeMove, type Position } from 'chessops/chess';
import { makeFen, parseFen, INITIAL_FEN } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import { makeUci, parseUci, squareFile, makeSquare } from 'chessops/util';
import type { Move, NormalMove } from 'chessops/types';
import type { Color } from './types';

export const START_FEN = INITIAL_FEN;

export function positionFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

/** Vollständige FEN; chessops setzt das ep-Feld nur, wenn ein ep-Schlag legal ist. */
export function fenOf(pos: Position): string {
  return makeFen(pos.toSetup());
}

/**
 * posKey = FEN ohne Halbzug- und Zugzähler, en passant nur wenn legal (Pflichtenheft 4.1).
 * Zugumstellungen fallen dadurch zusammen.
 */
export function posKeyOf(fenOrPos: string | Position): string {
  const pos = typeof fenOrPos === 'string' ? positionFromFen(fenOrPos) : fenOrPos;
  return fenOf(pos).split(' ').slice(0, 4).join(' ');
}

export function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** Vollständige FEN aus einem posKey (Zähler auf 0 1). */
export function fenFromPosKey(posKey: string): string {
  return `${posKey} 0 1`;
}

/** Standard-UCI: Rochade als Königszug um zwei Felder (e1g1), nicht König-schlägt-Turm (e1h1). */
export function stdUci(pos: Position, move: Move): string {
  if ('from' in move) {
    const side = castlingSide(pos, move);
    if (side) {
      const rank = Math.floor(move.from / 8);
      const toFile = side === 'h' ? 6 : 2;
      return makeSquare(move.from) + makeSquare(rank * 8 + toFile);
    }
  }
  return makeUci(move);
}

/** UCI (e1g1 oder e1h1) → interner chessops-Zug, oder undefined, wenn illegal. */
export function moveFromUci(pos: Position, uci: string): NormalMove | undefined {
  const m = parseUci(uci);
  if (!m || !('from' in m)) return undefined;
  // e1g1 → e1h1 (König schlägt Turm), falls Rochade
  let move: NormalMove = m;
  const piece = pos.board.get(m.from);
  if (piece?.role === 'king' && Math.abs(squareFile(m.from) - squareFile(m.to)) === 2) {
    const rank = Math.floor(m.from / 8);
    const rookFile = squareFile(m.to) > squareFile(m.from) ? 7 : 0;
    const candidate = { from: m.from, to: rank * 8 + rookFile };
    if (castlingSide(pos, candidate)) move = candidate;
  }
  move = normalizeMove(pos, move) as NormalMove;
  return pos.isLegal(move) ? move : undefined;
}

export interface PlayedMove {
  uci: string; // Standard-UCI
  san: string;
  fen: string; // FEN nach dem Zug
  posKey: string; // posKey nach dem Zug
}

/** Spielt einen UCI-Zug auf einer FEN. Wirft bei illegalem Zug. */
export function playUci(fen: string, uci: string): PlayedMove {
  const pos = positionFromFen(fen);
  const move = moveFromUci(pos, uci);
  if (!move) throw new Error(`Illegaler Zug ${uci} in ${fen}`);
  const san = makeSan(pos, move);
  const std = stdUci(pos, move);
  pos.play(move);
  const after = fenOf(pos);
  return { uci: std, san, fen: after, posKey: posKeyOf(pos) };
}

/** Spielt einen SAN-Zug (englische Notation). undefined bei illegal/ungültig. */
export function playSan(fen: string, san: string): PlayedMove | undefined {
  const pos = positionFromFen(fen);
  const move = parseSan(pos, san);
  if (!move || !('from' in move)) return undefined;
  const sanNorm = makeSan(pos, move);
  const std = stdUci(pos, move);
  pos.play(move);
  return { uci: std, san: sanNorm, fen: fenOf(pos), posKey: posKeyOf(pos) };
}

export function sanOf(fen: string, uci: string): string {
  const pos = positionFromFen(fen);
  const move = moveFromUci(pos, uci);
  return move ? makeSan(pos, move) : uci;
}

export function isLegalUci(fen: string, uci: string): boolean {
  return !!moveFromUci(positionFromFen(fen), uci);
}

/** Variante (Liste UCI) ab FEN in SAN umwandeln; bricht bei illegalem Zug ab. */
export function uciLineToSan(fen: string, ucis: string[], max = 99): string[] {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const u of ucis.slice(0, max)) {
    const m = moveFromUci(pos, u);
    if (!m) break;
    out.push(makeSan(pos, m));
    pos.play(m);
  }
  return out;
}

const DE_PIECES: Record<string, string> = { N: 'S', B: 'L', R: 'T', Q: 'D', K: 'K' };

/** Englische SAN → deutsche Anzeige-Notation (S, L, T, D, K). */
export function sanToDe(san: string): string {
  return san.replace(/[NBRQK]/g, (c) => DE_PIECES[c] ?? c);
}

export function displaySan(san: string, notation: 'de' | 'en'): string {
  return notation === 'de' ? sanToDe(san) : san;
}

/** Zugnummer-Präfix: ply 0 = 1. Zug Weiß. "1." bzw. "1…" */
export function moveNumberPrefix(ply: number, forceBlackNumber = true): string {
  const n = Math.floor(ply / 2) + 1;
  if (ply % 2 === 0) return `${n}.`;
  return forceBlackNumber ? `${n}…` : '';
}

/** "1.e4 e5 2.Sf3" aus einer SAN-Liste ab Ply startPly. */
export function formatLine(sans: string[], notation: 'de' | 'en' = 'de', startPly = 0): string {
  return sans
    .map((s, i) => {
      const ply = startPly + i;
      const prefix = ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}.` : i === 0 ? `${Math.floor(ply / 2) + 1}…` : '';
      return prefix + displaySan(s, notation);
    })
    .join(' ');
}

/** Ply-Zahl einer FEN (0 = Startstellung, Weiß am Zug). */
export function plyOfFen(fen: string): number {
  const parts = fen.split(' ');
  const full = Number(parts[5] ?? '1') || 1;
  return (full - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

/** Bauernstellung etc. werden später (F7) benötigt; hier nur Export der Position-Klasse. */
export type { Position };
