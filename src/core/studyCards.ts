// Lernkarten schon in der Studie (UI-frei, getestet).
// „Verstanden“ macht aus jeder eigenen Stellung einer Linie eine Karte (FSRS, wie im Training). Zwischenabfragen
// fragen frisch gelernte und fällige Karten ab. Bei der Übernahme ins Repertoire bekommen neue Repertoire-Karten
// diesen Lernstand – vorhandener Lernstand im Repertoire wird nie überschrieben.
// Stellungen, die das Ziel-Repertoire schon mit demselben Zug hat, übt das normale Training → keine Studienkarte.
import { turnOf } from './chess';
import { isDue, isNew, newSrs } from './srs';
import type { StudyTree } from './pgn';
import type { PathStep } from './study';
import type { LinePlan, StudyLine } from './studyLines';
import type { Color, SrsState } from './types';

export interface StudyCard {
  uci: string;
  srs: SrsState;
  /** Linie, in der die Karte entstanden ist */
  line?: string;
}
export type StudyCards = Record<string, StudyCard>;

export interface CheckItem {
  key: string;
  uci: string;
  /** Zugweg ab der Grundstellung bis zur Stellung (vor dem eigenen Zug) */
  path: PathStep[];
  fresh: boolean;
}

/** Eigene Stellungen einer Linie (dort ist man selbst am Zug). */
export function linePositions(tree: StudyTree, line: StudyLine, color: Color): { key: string; uci: string }[] {
  return line.steps.filter((s) => {
    const n = tree.nodes.get(s.key);
    return !!n && turnOf(n.fen) === color;
  });
}

/** Karten für eine Linie anlegen: fehlende neu, bei geändertem Zug neu begonnen; vorhandene bleiben. */
export function addLineCards(
  cards: StudyCards,
  positions: { key: string; uci: string }[],
  lineId: string,
  now: number,
  skip: (key: string, uci: string) => boolean = () => false,
): StudyCards {
  let out: StudyCards | undefined;
  for (const p of positions) {
    if (skip(p.key, p.uci)) continue;
    const cur = cards[p.key];
    if (cur && cur.uci === p.uci) continue;
    out ??= { ...cards };
    out[p.key] = { uci: p.uci, srs: newSrs(now), line: lineId };
  }
  return out ?? cards;
}

/** Zugweg zu einer Stellung laut Linienplan; undefined, wenn die Karte nicht mehr zum Plan passt (Zug entfernt/geändert). */
export function cardPath(plan: LinePlan, key: string, uci: string): PathStep[] | undefined {
  const o = plan.owner.get(key);
  if (!o) return undefined;
  const l = plan.lines[o.line];
  if (l.steps[o.step]?.uci !== uci) return undefined;
  return [...l.start, ...l.steps.slice(0, o.step)];
}

/**
 * Abfrage-Runde: zuerst frisch gelernte Karten (Planreihenfolge), dann fällige (am längsten fällig zuerst).
 * Karten, die nicht mehr zum Plan passen oder übersprungen werden sollen (schon im Repertoire), fallen weg.
 */
export function pickCheck(
  cards: StudyCards,
  plan: LinePlan,
  now: number,
  opts: { max?: number; skip?: (key: string, uci: string) => boolean } = {},
): CheckItem[] {
  const max = opts.max ?? 12;
  const fresh: (CheckItem & { order: number })[] = [];
  const due: (CheckItem & { due: number })[] = [];
  for (const [key, c] of Object.entries(cards)) {
    if (opts.skip?.(key, c.uci)) continue;
    const path = cardPath(plan, key, c.uci);
    if (!path) continue;
    if (isNew(c.srs)) {
      const o = plan.owner.get(key)!;
      fresh.push({ key, uci: c.uci, path, fresh: true, order: o.line * 1000 + o.step });
    } else if (isDue(c.srs, now)) due.push({ key, uci: c.uci, path, fresh: false, due: c.srs.due });
  }
  fresh.sort((a, b) => a.order - b.order);
  due.sort((a, b) => a.due - b.due);
  return [...fresh, ...due].slice(0, max).map(({ key, uci, path, fresh: f }) => ({ key, uci, path, fresh: f }));
}

/** Anzahl abfragbarer Karten (neu oder fällig) – für den „Abfrage (N)“-Knopf. */
export function checkCount(cards: StudyCards, plan: LinePlan, now: number, skip?: (key: string, uci: string) => boolean): number {
  return pickCheck(cards, plan, now, { max: Infinity, skip }).length;
}

/** Lernstand für die Übernahme: Studienkarten mit Historie, deren Zug dem übernommenen Eintrag entspricht. */
export function adoptable(cards: StudyCards | undefined, entries: { posKey: string; uci: string }[]): { posKey: string; uci: string; srs: SrsState }[] {
  if (!cards) return [];
  const out: { posKey: string; uci: string; srs: SrsState }[] = [];
  for (const e of entries) {
    const c = cards[e.posKey];
    if (c && c.uci === e.uci && !isNew(c.srs)) out.push({ posKey: e.posKey, uci: e.uci, srs: c.srs });
  }
  return out;
}
