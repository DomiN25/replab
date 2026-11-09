// Lernmodus für Studien: Zerlegung des Studienbaums in „Linien“ und eine sinnvolle Lernreihenfolge. (UI-frei, getestet)
//
// Linie = ein Abzweig + die Hauptfortsetzung bis zum Ende. Jede Stellung gehört genau einer Linie – der, in der sie
// in Lernreihenfolge zuerst vorkommt. Führt eine Linie per Zugumstellung in eine schon bekannte Stellung, endet sie
// dort (transposeTo) statt den Stoff zu wiederholen.
//
// Ebene (level) = Anzahl der Abweichungen von Kapitel-Hauptvarianten auf dem Weg dorthin:
//   0 = Hauptvariante eines Kapitels, 1 = Nebenlinie, 2 = Untervariante, 3+ = Detail.
// Reihenfolge „Gerüst zuerst“ (skeleton): erst alle Ebene-0-Linien, dann Ebene 1 usw.; innerhalb einer Ebene in
// Studienreihenfolge (Abzweige entlang der Linie von vorn nach hinten, an einer Stellung in PGN-Reihenfolge).
// „Wie in der Studie“ (study): reine Studienreihenfolge (Tiefensuche), Ebenen egal.
//
// Eigene Züge: nur der gewählte (Wahl > vorhandener Repertoirezug > erster Studienzug) – wie bei der Übernahme.
import { turnOf } from './chess';
import { cutKey, type ExistingEntry, type StudyTree } from './pgn';
import type { PathStep } from './study';
import type { Study } from './types';

export type LineOrder = 'skeleton' | 'study';

export interface StudyLine {
  /** 'main' für die erste Linie, sonst cutKey(Abzweig-Stellung, erster Zug) – stabil, solange der Abzweig existiert */
  id: string;
  level: number;
  /** Weg von der Grundstellung bis zum Abzweig */
  start: PathStep[];
  /** Züge der Linie ab dem Abzweig */
  steps: PathStep[];
  /** Linie, von der abgezweigt wird */
  parent?: number;
  /** endet in einer Stellung, die schon zu einer früheren Linie gehört */
  transposeTo?: { key: string; line: number; step: number };
  /** Anzahl kommentierter Züge */
  comments: number;
  /** Kapitel, zu dem die Linie gehört (niedrigstes aktives Kapitel ihres ersten Zugs) – für die Fortschrittskarte */
  chapter: number;
}

export interface LinePlan {
  lines: StudyLine[];
  byId: Map<string, number>;
  /** Stellung → Linie und Schritt (Anzahl Züge der Linie bis dorthin), in der sie zuerst vorkommt */
  owner: Map<string, { line: number; step: number }>;
  /** Anzahl Linien je Ebene (Index = Ebene) */
  perLevel: number[];
}

interface Pending {
  from: string;
  path: PathStep[];
  uci?: string;
  level: number;
  ord: number[];
  parent?: number;
}

const cmpOrd = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** Kleiner Binär-Heap (Prioritätswarteschlange) für die nächsten Abzweige. */
class Heap<T> {
  private a: T[] = [];
  constructor(private less: (x: T, y: T) => boolean) {}
  get size() {
    return this.a.length;
  }
  push(x: T) {
    const a = this.a;
    a.push(x);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export function buildLinePlan(
  tree: StudyTree,
  st: Pick<Study, 'color' | 'cuts' | 'choices'>,
  active: Set<number>,
  existing: Map<string, ExistingEntry>,
  order: LineOrder = 'skeleton',
): LinePlan {
  const cuts = new Set(st.cuts);
  // Züge, die zur Hauptvariante eines aktiven Kapitels gehören
  const mainMoves = new Set<string>();
  for (const ch of tree.chapters) {
    if (!active.has(ch.index)) continue;
    let key = tree.root;
    for (const uci of ch.mainline) {
      const m = tree.nodes.get(key)?.moves.find((x) => x.uci === uci);
      if (!m) break;
      mainMoves.add(cutKey(key, uci));
      key = m.child;
    }
  }
  const isMain = (key: string, uci: string) => mainMoves.has(cutKey(key, uci));

  /** Fortsetzungen einer Stellung in Lernreihenfolge (Hauptvarianten-Züge zuerst, sonst PGN-Reihenfolge). */
  const continuations = (key: string) => {
    const node = tree.nodes.get(key);
    if (!node) return [];
    const cands = node.moves.filter((m) => m.chapters.some((c) => active.has(c)) && !cuts.has(cutKey(key, m.uci)));
    let list = cands;
    if (turnOf(node.fen) === st.color) {
      const choice = st.choices[key];
      const chosen = (choice && cands.some((m) => m.uci === choice) ? choice : undefined) ?? existing.get(key)?.uci ?? cands[0]?.uci;
      list = cands.filter((m) => m.uci === chosen);
    }
    return [...list].sort((a, b) => Number(isMain(key, b.uci)) - Number(isMain(key, a.uci)));
  };

  const less =
    order === 'skeleton'
      ? (x: Pending, y: Pending) => x.level - y.level < 0 || (x.level === y.level && cmpOrd(x.ord, y.ord) < 0)
      : (x: Pending, y: Pending) => cmpOrd(x.ord, y.ord) < 0;
  const heap = new Heap<Pending>(less);
  const lines: StudyLine[] = [];
  const owner = new Map<string, { line: number; step: number }>();
  heap.push({ from: tree.root, path: [], level: 0, ord: [] });

  while (heap.size) {
    const p = heap.pop()!;
    const idx = lines.length;
    if (p.uci === undefined) owner.set(p.from, { line: idx, step: 0 });
    const steps: PathStep[] = [];
    let key = p.from;
    let uci = p.uci;
    let branchNo = 0;
    let transposeTo: StudyLine['transposeTo'];
    let comments = 0;
    for (;;) {
      if (uci === undefined) {
        const conts = continuations(key);
        if (!conts.length) break;
        // Abzweige dieser Stellung gehören zu dieser Linie
        for (const alt of conts.slice(1)) {
          heap.push({
            from: key,
            path: [...p.path, ...steps],
            uci: alt.uci,
            level: p.level + (isMain(key, alt.uci) ? 0 : 1),
            ord: [...p.ord, branchNo++],
            parent: idx,
          });
        }
        uci = conts[0].uci;
      }
      const mv = tree.nodes.get(key)?.moves.find((m) => m.uci === uci);
      if (!mv) break;
      steps.push({ key, uci });
      if (mv.comment) comments++;
      const known = owner.get(mv.child);
      if (known) {
        transposeTo = { key: mv.child, ...known };
        break;
      }
      owner.set(mv.child, { line: idx, step: steps.length });
      key = mv.child;
      uci = undefined;
    }
    if (!steps.length) continue;
    const firstMove = tree.nodes.get(steps[0].key)?.moves.find((m) => m.uci === steps[0].uci);
    const chMin = Math.min(...(firstMove?.chapters.filter((c) => active.has(c)) ?? []));
    const chapter = Number.isFinite(chMin) ? chMin : 0;
    lines.push({ id: p.uci === undefined ? 'main' : cutKey(p.from, p.uci), level: p.level, start: p.path, steps, parent: p.parent, transposeTo, comments, chapter });
  }

  const byId = new Map(lines.map((l, i) => [l.id, i]));
  const perLevel: number[] = [];
  for (const l of lines) perLevel[l.level] = (perLevel[l.level] ?? 0) + 1;
  for (let i = 0; i < perLevel.length; i++) perLevel[i] ??= 0;
  return { lines, byId, owner, perLevel };
}

/** Nächste noch nicht erledigte Linie nach `from` (am Ende wieder von vorn); undefined = alles erledigt. */
export function nextOpenLine(plan: LinePlan, done: Set<string>, from: number): number | undefined {
  const n = plan.lines.length;
  for (let i = 1; i <= n; i++) {
    const j = (from + i + n) % n;
    if (!done.has(plan.lines[j].id)) return j;
  }
  return undefined;
}

/**
 * Wohin führt der Zug `uci` in Stellung `key`? Abzweig → dessen Linie (nach dem ersten Zug),
 * Fortsetzung einer Linie → dieselbe Linie einen Schritt weiter. undefined = Zug gehört zu keiner Linie
 * (z. B. nicht gewählter eigener Zug oder entfernt).
 */
export function lineForMove(plan: LinePlan, key: string, uci: string): { line: number; step: number } | undefined {
  const b = plan.byId.get(cutKey(key, uci));
  if (b !== undefined) return { line: b, step: 1 };
  const o = plan.owner.get(key);
  if (!o) return undefined;
  const l = plan.lines[o.line];
  if (l.steps[o.step]?.uci === uci) return { line: o.line, step: o.step + 1 };
  return undefined;
}

/** Linie und Schritt, in der eine Stellung zuerst vorkommt (für „Lernen ab hier“). */
export function lineAt(plan: LinePlan, key: string): { line: number; step: number } | undefined {
  return plan.owner.get(key);
}

export const LEVEL_NAMES = ['Hauptlinie', 'Nebenlinie', 'Untervariante', 'Detail'];
export const levelName = (level: number) => LEVEL_NAMES[Math.min(level, LEVEL_NAMES.length - 1)];
