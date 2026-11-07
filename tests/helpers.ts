import { START_FEN, playSan, posKeyOf, positionFromFen } from '../src/core/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare } from 'chessops/util';
import type { EngineData, ExplorerData, PositionMark } from '../src/core/types';
import type { RelevanceSettings } from '../src/core/relevance';

export const SETTINGS: RelevanceSettings = {
  minShare: 0.05,
  minGames: 20,
  nearBestCp: 50,
  trapLossCp: 100,
  trapMinShare: 0.1,
};

/** FEN nach einer SAN-Folge ab Grundstellung. */
export function fenAfter(sans: string[], fen = START_FEN): string {
  let f = fen;
  for (const s of sans) {
    const r = playSan(f, s);
    if (!r) throw new Error(`illegal ${s} after ${f}`);
    f = r.fen;
  }
  return f;
}

export function keyAfter(sans: string[]): string {
  return posKeyOf(fenAfter(sans));
}

/** Explorer-Daten: [SAN, Partien] – Ergebnisse gleichmäßig verteilt. */
export function explorer(sans: string[], moves: [string, number][], opening?: string): ExplorerData {
  const fen = fenAfter(sans);
  const ms = moves.map(([san, games]) => {
    const p = playSan(fen, san)!;
    const w = Math.floor(games / 3);
    return { uci: p.uci, san: p.san, white: w, draws: w, black: games - 2 * w };
  });
  const total = ms.reduce((s, m) => s + m.white + m.draws + m.black, 0);
  return {
    key: posKeyOf(fen),
    posKey: posKeyOf(fen),
    moves: ms,
    total,
    opening: opening ? { eco: 'X00', name: opening } : undefined,
    fetchedAt: 0,
  };
}

/** Engine-Daten: [SAN, cp aus Sicht der Seite am Zug]. */
export function engine(sans: string[], lines: [string, number][]): EngineData {
  const fen = fenAfter(sans);
  return {
    posKey: posKeyOf(fen),
    depth: 18,
    analysedAt: 0,
    lines: lines.map(([san, cp]) => {
      const p = playSan(fen, san)!;
      return { uci: p.uci, san: p.san, cp, pv: [p.uci] };
    }),
  };
}

export function mark(sans: string[], m: Partial<PositionMark>): PositionMark {
  return { repertoireId: 'r', posKey: keyAfter(sans), updatedAt: 0, ...m };
}

export function legalUcis(fen: string): string[] {
  const pos = positionFromFen(fen);
  const dests = chessgroundDests(pos, { chess960: false });
  const out: string[] = [];
  for (const [from, tos] of dests) {
    const isPawn = fen.split(' ')[0] && pos.board.getRole(parseSquare(from)!) === 'pawn';
    for (const to of tos) out.push(from + to + (isPawn && (to[1] === '1' || to[1] === '8') ? 'q' : ''));
  }
  return out.sort();
}

/** Deterministischer Zufallsgenerator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
