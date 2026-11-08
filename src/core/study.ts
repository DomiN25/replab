// Studien-Reiter: was wird aus einer bearbeiteten Studie übernommen? (UI-frei, getestet)
// Gleiche Regeln wie der PGN-Import (planImport): pro Stellung ein eigener Zug – gewählt > vorhandener
// Repertoirezug > erster Zug der Studie (Hauptvariante). Entfernte Züge und abgewählte Kapitel fallen weg.
import { turnOf } from './chess';
import { cutKey, type ExistingEntry, type StudyFilter, type StudyMove, type StudyNode, type StudyTree } from './pgn';
import type { Study } from './types';

export function studyFilter(st: Pick<Study, 'cuts' | 'skipChapters'>): StudyFilter {
  return { cuts: new Set(st.cuts), skipChapters: new Set(st.skipChapters) };
}

/** Kapitel, die zählen: nicht abgewählt und nicht ausdrücklich für die andere Farbe. */
export function activeChapters(tree: StudyTree, st: Pick<Study, 'color' | 'skipChapters'>): Set<number> {
  const skip = new Set(st.skipChapters);
  return new Set(tree.chapters.filter((c) => !skip.has(c.index) && (!c.color || c.color === st.color)).map((c) => c.index));
}

export type MoveStatus =
  | 'chosen' // eigener Zug, wird übernommen
  | 'alt' // eigener Zug, aber ein anderer ist gewählt → Ast fällt weg
  | 'opp' // Gegnerzug, wird übernommen
  | 'cut'; // vom Nutzer entfernt

export interface MoveView extends StudyMove {
  status: MoveStatus;
  /** entspricht dem vorhandenen Repertoirezug */
  inRep: boolean;
}

export interface NodeView {
  mine: boolean;
  moves: MoveView[];
  /** vorhandener Repertoirezug in dieser Stellung (falls es einen gibt) */
  repMove?: ExistingEntry;
  /** Zug, der übernommen würde (nur eigene Stellungen); kann der Repertoirezug sein, der in der Studie fehlt */
  chosen?: string;
}

export function nodeView(node: StudyNode, st: Study, active: Set<number>, existing: Map<string, ExistingEntry>): NodeView {
  const mine = turnOf(node.fen) === st.color;
  const cuts = new Set(st.cuts);
  const visible = node.moves.filter((m) => m.chapters.some((c) => active.has(c)));
  const repMove = mine ? existing.get(node.key) : undefined;
  const candidates = visible.filter((m) => !cuts.has(cutKey(node.key, m.uci)));
  const choice = st.choices[node.key];
  const chosen = mine
    ? (choice && candidates.some((m) => m.uci === choice) ? choice : undefined) ?? repMove?.uci ?? candidates[0]?.uci
    : undefined;
  const moves = visible.map((m): MoveView => {
    const cut = cuts.has(cutKey(node.key, m.uci));
    const status: MoveStatus = cut ? 'cut' : !mine ? 'opp' : m.uci === chosen ? 'chosen' : 'alt';
    return { ...m, status, inRep: !!repMove && repMove.uci === m.uci };
  });
  return { mine, moves, repMove, chosen };
}

export interface PathStep {
  key: string; // Stellung vor dem Zug
  uci: string;
}

/**
 * Wird die Stellung am Ende des Pfads übernommen? Liefert den Index des ersten Zugs, der den Ast ausschließt
 * (entfernt oder nicht gewählter eigener Zug), sonst undefined.
 */
export function firstExcluded(
  tree: StudyTree,
  path: PathStep[],
  st: Study,
  active: Set<number>,
  existing: Map<string, ExistingEntry>,
): { index: number; reason: 'cut' | 'alt' } | undefined {
  for (let i = 0; i < path.length; i++) {
    const node = tree.nodes.get(path[i].key);
    if (!node) return undefined;
    const v = nodeView(node, st, active, existing);
    const m = v.moves.find((x) => x.uci === path[i].uci);
    if (m?.status === 'cut') return { index: i, reason: 'cut' };
    if (m?.status === 'alt') return { index: i, reason: 'alt' };
  }
  return undefined;
}

/** Anzahl Stellungen (Knoten) eines Teilbaums – für „Ast entfernen (n Stellungen)“. Zugumstellungen zählen einmal. */
export function subtreeSize(tree: StudyTree, key: string, active: Set<number>): number {
  const seen = new Set<string>();
  const stack = [key];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const n = tree.nodes.get(k);
    for (const m of n?.moves ?? []) if (m.chapters.some((c) => active.has(c))) stack.push(m.child);
  }
  return seen.size;
}

/**
 * Alle Stellungen der Studie in Lesereihenfolge (Tiefensuche, Hauptvariante zuerst, nur aktive Kapitel und
 * nicht entfernte Züge), jeweils mit Zugweg ab der Grundstellung. Zugumstellungen nur beim ersten Erreichen.
 */
export function readingOrder(tree: StudyTree, st: Pick<Study, 'cuts'>, active: Set<number>): { key: string; path: PathStep[] }[] {
  const cuts = new Set(st.cuts);
  const out: { key: string; path: PathStep[] }[] = [];
  const seen = new Set<string>();
  const rec = (key: string, path: PathStep[]) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, path });
    for (const m of tree.nodes.get(key)?.moves ?? []) {
      if (!m.chapters.some((c) => active.has(c)) || cuts.has(cutKey(key, m.uci))) continue;
      rec(m.child, [...path, { key, uci: m.uci }]);
    }
  };
  rec(tree.root, []);
  return out;
}

/**
 * Nächste noch nicht angesehene Stellung in Lesereihenfolge, ab der aktuellen Stellung weitergesucht
 * (am Ende wieder von vorn). undefined = alles angesehen.
 */
export function nextUnseen(order: { key: string; path: PathStep[] }[], seen: Set<string>, currentKey: string): PathStep[] | undefined {
  if (!order.length) return undefined;
  const start = Math.max(0, order.findIndex((x) => x.key === currentKey));
  for (let i = 1; i <= order.length; i++) {
    const x = order[(start + i) % order.length];
    if (!seen.has(x.key)) return x.path;
  }
  return undefined;
}

