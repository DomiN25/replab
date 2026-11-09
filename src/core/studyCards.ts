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
  /** in dieser Runde schon falsch beantwortet – kommt am Ende noch einmal */
  retry?: boolean;
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

// ------------------------------------------------------------ Lernlast und Rundengröße
// Wann abfragen? Nicht nach starrer Linienzahl, sondern nach Lernlast: jede neu gelernte eigene Stellung zählt 1,
// leicht verwechselbare 1,5. Verwechselbar = eine andere gelernte Stellung hat lange denselben Weg und weicht dann ab
// (z. B. nach 7…Le7 spielst du X, nach 7…Sd4 Y) – genau dort entstehen Verwechslungen, daher früher prüfen.
// Schwellwert ≈ Arbeitsgedächtnis (Standard 6); eine lange Linie löst also sofort aus, drei kurze nicht unbedingt.

/** Länge des gemeinsamen Anfangs zweier Zugwege */
function commonPrefix(a: PathStep[], b: PathStep[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i].key === b[i].key && a[i].uci === b[i].uci) i++;
  return i;
}

/** Verwechselbar: gemeinsamer Weg ≥ 4 Halbzüge und ≥ 60 % des kürzeren Wegs, aber keiner ist Fortsetzung des anderen. */
export function confusable(a: PathStep[], b: PathStep[]): boolean {
  const cp = commonPrefix(a, b);
  if (cp === a.length || cp === b.length) return false; // gleiche Linie (eine Stellung folgt auf die andere)
  return cp >= 4 && cp >= 0.6 * Math.min(a.length, b.length);
}

export const CHECK_LOAD = { often: 4, normal: 6, rare: 10 } as const;
export type CheckPace = keyof typeof CHECK_LOAD;

/** Lernlast der neu gelernten (noch nie abgefragten) Karten. */
export function freshLoad(
  cards: StudyCards,
  plan: LinePlan,
  skip?: (key: string, uci: string) => boolean,
): { load: number; fresh: CheckItem[] } {
  const all = Object.entries(cards)
    .filter(([key, c]) => !skip?.(key, c.uci))
    .map(([key, c]) => ({ key, c, path: cardPath(plan, key, c.uci) }))
    .filter((x): x is { key: string; c: StudyCard; path: PathStep[] } => !!x.path);
  const fresh = all.filter((x) => isNew(x.c.srs));
  let load = 0;
  for (const f of fresh) {
    const hard = all.some((o) => o.key !== f.key && confusable(f.path, o.path));
    load += hard ? 1.5 : 1;
  }
  const order = (k: string) => {
    const o = plan.owner.get(k)!;
    return o.line * 1000 + o.step;
  };
  fresh.sort((a, b) => order(a.key) - order(b.key));
  return { load, fresh: fresh.map((x) => ({ key: x.key, uci: x.c.uci, path: x.path, fresh: true })) };
}

/**
 * Abfrage-Runde, Größe passend zum Gelernten: alle neu gelernten Stellungen (höchstens 15) plus fällige Wiederholungen
 * im Verhältnis – etwa die Hälfte der neuen, mindestens 3 (beim Start von Hand bis 12 fällige).
 */
export function buildRound(
  cards: StudyCards,
  plan: LinePlan,
  now: number,
  opts: { skip?: (key: string, uci: string) => boolean; manual?: boolean } = {},
): CheckItem[] {
  const fresh = freshLoad(cards, plan, opts.skip).fresh.slice(0, 15);
  const due = pickCheck(cards, plan, now, { max: Infinity, skip: opts.skip }).filter((i) => !i.fresh);
  const dueMax = opts.manual ? Math.max(12 - fresh.length, 3) : Math.max(3, Math.ceil(fresh.length / 2));
  return [...fresh, ...due.slice(0, dueMax)];
}
