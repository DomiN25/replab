// Kandidatenzüge: welche Gegnerzüge sind relevant (F3), Fallen-Markierung (F6),
// und die Kandidatentabelle für eigene Züge (F2).
import { playUci, sanOf } from './chess';
import type { EngineData, EngineLine, ExplorerData, PositionMark } from './types';

export interface RelevanceSettings {
  minShare: number; // 0..1
  minGames: number;
  nearBestCp: number;
  trapLossCp: number;
  trapMinShare: number;
}

export const MATE_CP = 100000;

/** Bewertung einer Engine-Linie in Centipawns aus Sicht der Seite am Zug. */
export function lineScore(line: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (line.mate !== undefined && line.mate !== null) {
    return line.mate > 0 ? MATE_CP - line.mate : -MATE_CP - line.mate;
  }
  return line.cp ?? 0;
}

export type Reason = 'db' | 'engine' | 'extra';

export interface OppCandidate {
  uci: string;
  san: string;
  games: number;
  share?: number; // 0..1, nur wenn Explorer-Daten vorliegen
  white: number;
  draws: number;
  black: number;
  engineRank?: number; // 0 = bester Zug laut Engine
  /** Bewertung nach dem Zug aus Sicht des Ziehenden (Gegner), cp. */
  moverCp?: number;
  /** Verlust gegenüber dem besten Zug aus Sicht des Ziehenden (≥ 0). */
  lossCp?: number;
  reasons: Reason[];
  ignored: boolean;
  relevant: boolean;
  trap: boolean;
}

export interface CandidateInput {
  fen: string;
  explorer?: ExplorerData;
  engine?: EngineData;
  /** Engine-Daten der Folgestellung (falls schon analysiert) – Fallback für die Bewertung. */
  childEngine?: (posKey: string) => EngineData | undefined;
  mark?: PositionMark;
  settings: RelevanceSettings;
}

/** Alle bekannten Gegnerzüge mit Relevanz-Flag, sortiert (relevant zuerst, dann Häufigkeit). */
export function oppCandidates(input: CandidateInput): OppCandidate[] {
  const { fen, explorer, engine, mark, settings } = input;
  const byUci = new Map<string, OppCandidate>();
  const total = explorer?.total ?? 0;

  const get = (uci: string, san?: string): OppCandidate => {
    let c = byUci.get(uci);
    if (!c) {
      c = {
        uci,
        san: san ?? sanOf(fen, uci),
        games: 0,
        white: 0,
        draws: 0,
        black: 0,
        reasons: [],
        ignored: false,
        relevant: false,
        trap: false,
      };
      byUci.set(uci, c);
    }
    return c;
  };

  if (explorer) {
    for (const m of explorer.moves) {
      const c = get(m.uci, m.san);
      c.white = m.white;
      c.draws = m.draws;
      c.black = m.black;
      c.games = m.white + m.draws + m.black;
      c.share = total > 0 ? c.games / total : 0;
      if (total > 0 && c.share >= settings.minShare && c.games >= settings.minGames) c.reasons.push('db');
    }
  }

  const lines = engine?.lines ?? [];
  const best = lines.length ? lineScore(lines[0]) : undefined;
  lines.forEach((l, i) => {
    const c = get(l.uci, l.san);
    c.engineRank = i;
    c.moverCp = lineScore(l);
    c.lossCp = best !== undefined ? Math.max(0, best - c.moverCp) : undefined;
    if (i < 3 && c.lossCp !== undefined && c.lossCp <= settings.nearBestCp) c.reasons.push('engine');
  });

  for (const uci of mark?.extraOppMoves ?? []) {
    const c = get(uci);
    if (!c.reasons.includes('extra')) c.reasons.push('extra');
  }

  const ignored = new Set(mark?.ignoredOppMoves ?? []);
  for (const c of byUci.values()) {
    // Fallback-Bewertung über die Folgestellung (dort bin ich am Zug → Vorzeichen drehen)
    if (c.moverCp === undefined && best !== undefined && input.childEngine) {
      try {
        const child = playUci(fen, c.uci);
        const ce = input.childEngine(child.posKey);
        if (ce?.lines.length) {
          c.moverCp = -lineScore(ce.lines[0]);
          c.lossCp = Math.max(0, best - c.moverCp);
        }
      } catch {
        /* illegaler Zug in Fremddaten – ignorieren */
      }
    }
    c.ignored = ignored.has(c.uci);
    c.relevant = !c.ignored && c.reasons.length > 0;
    c.trap =
      c.share !== undefined &&
      c.share >= settings.trapMinShare &&
      c.lossCp !== undefined &&
      c.lossCp >= settings.trapLossCp;
  }

  return [...byUci.values()].sort((a, b) => {
    if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
    if (b.games !== a.games) return b.games - a.games;
    return (a.engineRank ?? 99) - (b.engineRank ?? 99);
  });
}

export interface MyCandidate {
  uci: string;
  san: string;
  games: number;
  share?: number;
  white: number;
  draws: number;
  black: number;
  engineRank?: number;
  /** Bewertung aus meiner Sicht (ich bin am Zug), cp. */
  cp?: number;
  mate?: number;
  /** Abweichung zum besten Engine-Zug (≥ 0). */
  deltaCp?: number;
}

/** Kandidatentabelle, wenn ich am Zug bin: Explorer ∪ Engine. */
export function myCandidates(fen: string, explorer?: ExplorerData, engine?: EngineData): MyCandidate[] {
  const map = new Map<string, MyCandidate>();
  const total = explorer?.total ?? 0;
  for (const m of explorer?.moves ?? []) {
    const games = m.white + m.draws + m.black;
    map.set(m.uci, {
      uci: m.uci,
      san: m.san,
      games,
      share: total ? games / total : 0,
      white: m.white,
      draws: m.draws,
      black: m.black,
    });
  }
  const lines = engine?.lines ?? [];
  const best = lines.length ? lineScore(lines[0]) : undefined;
  lines.forEach((l, i) => {
    let c = map.get(l.uci);
    if (!c) {
      c = { uci: l.uci, san: l.san || sanOf(fen, l.uci), games: 0, white: 0, draws: 0, black: 0 };
      map.set(l.uci, c);
    }
    c.engineRank = i;
    c.cp = l.cp;
    c.mate = l.mate;
    c.deltaCp = best !== undefined ? Math.max(0, best - lineScore(l)) : undefined;
  });
  return [...map.values()].sort((a, b) => b.games - a.games || (a.engineRank ?? 99) - (b.engineRank ?? 99));
}

/** Ab diesem Vorsprung (cp) des besten Zugs vor dem zweitbesten wird er stärker hervorgehoben. */
export const STANDOUT_CP = 50;

/** Bester Zug, falls er mit Abstand vorn liegt (≥ minCp vor dem Zweitbesten); Linien sind nach Stärke sortiert. */
export function standoutMove(lines: Pick<EngineLine, 'uci' | 'cp' | 'mate'>[], minCp = STANDOUT_CP): string | undefined {
  if (lines.length < 2) return undefined;
  return lineScore(lines[0]) - lineScore(lines[1]) >= minCp ? lines[0].uci : undefined;
}

/** Anzeige einer Bewertung: "+0,35", "#3", "−1,20". */
export function formatEval(cp?: number, mate?: number): string {
  if (mate !== undefined && mate !== null) return (mate > 0 ? '#' : '#−') + Math.abs(mate);
  if (cp === undefined || cp === null) return '–';
  const v = (cp / 100).toFixed(2).replace('.', ',');
  return cp > 0 ? `+${v}` : cp < 0 ? v.replace('-', '−') : '0,00';
}
