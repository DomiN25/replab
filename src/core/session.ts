// Trainings-Sitzung (F5): Reihenfolge ohne „dieselbe Linie am Stück“, Relearning genau einmal.
//
// Idee: Jede Karte hat einen Pfad (UCI-Züge ab Grundstellung, erste Fundstelle). Der Abstand zweier
// Karten ist die Baumdistanz (Halbzüge bis zum gemeinsamen Vorfahren, beide Seiten addiert).
// Zwei aufeinanderfolgende Karten mit Abstand ≤ minDistance gelten als „dieselbe Linie“ und werden
// vermieden, solange es Alternativen gibt.
import type { TrainingMode } from './types';

export interface SessionItem {
  cardId: string;
  posKey: string;
  /** UCI-Pfad ab Grundstellung; undefined = unbekannt (z. B. verwaiste Karte). */
  path?: string[];
  /** Höher = früher (z. B. Überfälligkeit, Erreichwahrscheinlichkeit). */
  priority: number;
}

/** 'show' wird nicht mehr neu erzeugt, nur noch aus alten gespeicherten Sitzungen gelesen. */
export type StepKind = 'show' | 'ask';

export interface Step {
  cardId: string;
  kind: StepKind;
  attempt: 1 | 2;
}

export interface SessionResult {
  cardId: string;
  attempt: 1 | 2;
  correct: boolean;
}

export interface Session {
  mode: TrainingMode;
  items: Record<string, SessionItem>;
  steps: Step[];
  index: number;
  results: SessionResult[];
  minDistance: number;
  relearnGap: number;
}

export interface SessionOptions {
  minDistance?: number; // Standard 4 Halbzüge
  relearnGap?: number; // Relearning frühestens nach so vielen Karten (Standard 4)
  rand?: () => number;
}

export function commonPrefix(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Baumdistanz zweier Stellungen über ihre Pfade. */
export function lineDistance(a?: string[], b?: string[]): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const c = commonPrefix(a, b);
  return a.length - c + (b.length - c);
}

/** Gruppe für die Klumpen-Vermeidung: die ersten 4 Halbzüge. */
const clusterOf = (it: SessionItem) => (it.path ? it.path.slice(0, 4).join(' ') : `?${it.cardId}`);

/**
 * Ordnet Karten so, dass aufeinanderfolgende Karten nicht aus derselben Linie stammen.
 *
 * Gierig wie beim klassischen „keine zwei Gleichen nebeneinander“: Unter den gültigen Kandidaten
 * (andere Gruppe als die letzte Karte, Baumdistanz > minDistance) wird die Karte aus der Gruppe
 * mit den meisten Restkarten gewählt – so bleibt am Ende kein Klumpen einer Linie übrig.
 * Bei Gleichstand entscheidet die Priorität. Die Priorität bestimmt vor allem, WELCHE Karten in
 * die Sitzung kommen (Auswahl vor dem Aufruf), die Reihenfolge darin dient der Abwechslung.
 */
export function diversify(items: SessionItem[], minDistance = 4, rand: () => number = Math.random): SessionItem[] {
  // Zufällige Reihenfolge bei gleicher Priorität
  const shuffled = items.map((it) => ({ it, r: rand() }));
  shuffled.sort((x, y) => y.it.priority - x.it.priority || x.r - y.r);
  const remaining = shuffled.map((x) => x.it);
  const out: SessionItem[] = [];
  const counts = new Map<string, number>();
  for (const it of remaining) counts.set(clusterOf(it), (counts.get(clusterOf(it)) ?? 0) + 1);

  while (remaining.length) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    const far = (it: SessionItem) => !last || lineDistance(it.path, last.path) > minDistance;
    const farPrev = (it: SessionItem) => !prev || lineDistance(it.path, prev.path) > minDistance / 2;
    const otherGroup = (it: SessionItem) => !last || clusterOf(it) !== clusterOf(last);
    const tiers = [(it: SessionItem) => far(it) && otherGroup(it), far];
    let valid = remaining;
    for (const t of tiers) {
      const v = remaining.filter(t);
      if (v.length) {
        valid = v;
        break;
      }
    }
    // Größte Restgruppe zuerst; bei Gleichstand: weit weg von der vorletzten Karte, dann Priorität
    const score = (it: SessionItem) => (counts.get(clusterOf(it)) ?? 0) * 2 + (farPrev(it) ? 1 : 0);
    let pick = valid[0];
    let best = score(pick);
    for (const it of valid) {
      const sc = score(it);
      if (sc > best) {
        best = sc;
        pick = it;
      }
    }
    out.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
    counts.set(clusterOf(pick), (counts.get(clusterOf(pick)) ?? 1) - 1);
  }
  return out;
}

export function createSession(mode: TrainingMode, items: SessionItem[], opts: SessionOptions = {}): Session {
  const minDistance = opts.minDistance ?? 4;
  const relearnGap = opts.relearnGap ?? 4;
  const rand = opts.rand ?? Math.random;
  const map: Record<string, SessionItem> = {};
  for (const it of items) map[it.cardId] = it;
  let steps: Step[];
  if (mode === 'line') {
    // Linien-Modus: bewusst in Zugreihenfolge
    steps = items.map((it) => ({ cardId: it.cardId, kind: 'ask', attempt: 1 }));
  } else {
    // Neu lernen wie Wiederholen: gleich abfragen. Die Züge sind schon festgelegt bzw. in Studien gesehen – der richtige Zug
    // erscheint erst nach einer falschen Antwort (kein vorheriges „Zeigen“).
    steps = diversify(items, minDistance, rand).map((it) => ({ cardId: it.cardId, kind: 'ask', attempt: 1 }));
  }
  return { mode, items: map, steps, index: 0, results: [], minDistance, relearnGap };
}

export function currentStep(s: Session): Step | undefined {
  return s.steps[s.index];
}

export function isFinished(s: Session): boolean {
  return s.index >= s.steps.length;
}

/** Wie oft wurde die Karte in dieser Sitzung schon abgefragt (inkl. geplanter Wiederholung)? */
export function askCount(s: Session, cardId: string): number {
  return s.steps.filter((st) => st.cardId === cardId && st.kind === 'ask').length;
}

/**
 * Antwort auf den aktuellen Schritt. Bei falscher Erstantwort wird die Karte genau einmal
 * später erneut eingeplant (nicht sofort, nicht neben eine Karte derselben Linie, wenn vermeidbar).
 */
export function answer(s: Session, correct: boolean): { relearnAt?: number } {
  const step = currentStep(s);
  if (!step) return {};
  if (step.kind === 'show') {
    s.index++;
    return {};
  }
  s.results.push({ cardId: step.cardId, attempt: step.attempt, correct });
  s.index++;
  if (!correct && step.attempt === 1 && s.mode !== 'line' && askCount(s, step.cardId) < 2) {
    const item = s.items[step.cardId];
    const relearn: Step = { cardId: step.cardId, kind: 'ask', attempt: 2 };
    const remaining = s.steps.length - s.index;
    // Wunschposition: nach relearnGap Karten (oder ans Ende)
    let at = s.index + Math.min(s.relearnGap, remaining);
    // Bis zu 3 Plätze weiter suchen, falls Nachbarn dieselbe Linie sind
    const conflicts = (pos: number) => {
      const before = s.steps[pos - 1];
      const after = s.steps[pos];
      const d = (st?: Step) => (st ? lineDistance(item.path, s.items[st.cardId]?.path) : Infinity);
      return d(before) <= s.minDistance || d(after) <= s.minDistance;
    };
    for (let k = 0; k <= 3 && at + k <= s.steps.length; k++) {
      if (!conflicts(at + k)) {
        at += k;
        break;
      }
    }
    at = Math.min(at, s.steps.length);
    s.steps.splice(at, 0, relearn);
    return { relearnAt: at };
  }
  return {};
}
