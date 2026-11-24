// Markierte Linien: Eine als „wichtig“ oder „spannend“ markierte Stellung gilt für die ganze Linie darunter (Teilbaum im
// Repertoire-Graphen). Wichtige Linien werden im Training öfter und bevorzugt abgefragt. UI-frei, getestet.
import { subtreeIds, type Graph } from './graph';
import type { PositionMark } from './types';

export interface LineMarks {
  /** posKeys in wichtigen Linien (markierte Stellung und alles darunter) */
  important: Set<string>;
  /** posKeys in spannenden Linien */
  sharp: Set<string>;
  /** posKeys auf dem Weg von der Grundstellung zu einer wichtigen Linie – zählen im Training mit (man muss dort hinkommen) */
  path: Set<string>;
}

export const EMPTY_LINE_MARKS: LineMarks = { important: new Set(), sharp: new Set(), path: new Set() };

/** Um so viel steigt die Ziel-Erinnerung für Karten in wichtigen Linien (kürzere Abstände = öfter abgefragt). */
export const IMPORTANT_RETENTION_BONUS = 0.05;

export function importantRetention(base: number): number {
  return Math.min(0.97, base + IMPORTANT_RETENTION_BONUS);
}

export function markedLines(g: Graph | undefined, marks: Iterable<PositionMark>): LineMarks {
  const important = new Set<string>();
  const sharp = new Set<string>();
  const path = new Set<string>();
  for (const m of marks) {
    if (!m.critical && !m.sharp) continue;
    const id = g?.byPosKey.get(m.posKey);
    const keys = id === undefined ? [m.posKey] : subtreeIds(g!, id).map((i) => g!.nodes[i].posKey);
    for (const k of keys) {
      if (m.critical) important.add(k);
      if (m.sharp) sharp.add(k);
    }
    // Weg dorthin: Elternkette bis zur Grundstellung
    if (m.critical && id !== undefined) for (let p = g!.nodes[id].parent, guard = 0; p >= 0 && guard < 400; p = g!.nodes[p].parent, guard++) path.add(g!.nodes[p].posKey);
  }
  return { important, sharp, path };
}

/** Für das Training: wichtige Linien samt Weg dorthin. */
export function trainImportant(lm: LineMarks): Set<string> {
  return new Set([...lm.important, ...lm.path]);
}
