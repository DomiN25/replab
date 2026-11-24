// Markierte Linien: Eine als „wichtig“ oder „spannend“ markierte Stellung gilt für die ganze Linie darunter (Teilbaum im
// Repertoire-Graphen). Wichtige Linien werden im Training öfter und bevorzugt abgefragt. UI-frei, getestet.
import { subtreeIds, type Graph } from './graph';
import type { PositionMark } from './types';

export interface LineMarks {
  /** posKeys in wichtigen Linien (markierte Stellung und alles darunter) */
  important: Set<string>;
  /** posKeys in spannenden Linien */
  sharp: Set<string>;
}

export const EMPTY_LINE_MARKS: LineMarks = { important: new Set(), sharp: new Set() };

/** Um so viel steigt die Ziel-Erinnerung für Karten in wichtigen Linien (kürzere Abstände = öfter abgefragt). */
export const IMPORTANT_RETENTION_BONUS = 0.05;

export function importantRetention(base: number): number {
  return Math.min(0.97, base + IMPORTANT_RETENTION_BONUS);
}

export function markedLines(g: Graph | undefined, marks: Iterable<PositionMark>): LineMarks {
  const important = new Set<string>();
  const sharp = new Set<string>();
  for (const m of marks) {
    if (!m.critical && !m.sharp) continue;
    const id = g?.byPosKey.get(m.posKey);
    const keys = id === undefined ? [m.posKey] : subtreeIds(g!, id).map((i) => g!.nodes[i].posKey);
    for (const k of keys) {
      if (m.critical) important.add(k);
      if (m.sharp) sharp.add(k);
    }
  }
  return { important, sharp };
}
