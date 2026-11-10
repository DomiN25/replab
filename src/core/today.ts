// „Heute“ über alles: was ist in JEDEM Repertoire und in JEDER Studie fällig? (UI-frei, getestet)
// Hintergrund: Karten liegen pro Repertoire, Studien haben eigene Lernkarten (core/studyCards.ts). Ohne diese
// Gesamtsicht sieht man Fälliges nur im gerade aktiven Repertoire bzw. erst nach dem Öffnen einer Studie.
import { buildStudyTree, type ExistingEntry } from './pgn';
import { isDue, isNew } from './srs';
import { activeChapters } from './study';
import { pickCheck } from './studyCards';
import { buildLinePlan } from './studyLines';
import type { Card, Study } from './types';

export interface DueCount {
  /** schon gelernt und jetzt fällig */
  due: number;
  /** noch nie abgefragt */
  fresh: number;
}

/** Fällige und neue Karten je Repertoire (pausierte zählen nicht). */
export function dueByRepertoire(cards: Card[], now: number): Map<string, DueCount> {
  const out = new Map<string, DueCount>();
  for (const c of cards) {
    if (c.suspended) continue;
    const n = out.get(c.repertoireId) ?? { due: 0, fresh: 0 };
    if (isNew(c.srs)) n.fresh++;
    else if (isDue(c.srs, now)) n.due++;
    out.set(c.repertoireId, n);
  }
  return out;
}

/**
 * Abfragbare Lernkarten einer Studie – dieselbe Zählung wie der Knopf „Abfrage (N)“ in der Studie:
 * Karten, die nicht mehr zum Plan passen (Zug entfernt/geändert) oder die das Ziel-Repertoire schon mit demselben
 * Zug hat, zählen nicht. Der Studienbaum wird nur gebaut, wenn überhaupt eine Karte in Frage kommt (teuer bei großen Studien).
 */
export function studyDue(st: Study, existing: Map<string, ExistingEntry>, now: number): DueCount {
  const cards = st.cards;
  if (!cards || !Object.values(cards).some((c) => isNew(c.srs) || isDue(c.srs, now))) return { due: 0, fresh: 0 };
  const tree = buildStudyTree(st.pgn);
  const plan = buildLinePlan(tree, st, activeChapters(tree, st), existing, st.learn?.order ?? 'skeleton');
  const items = pickCheck(cards, plan, now, { max: Infinity, skip: (k, uci) => existing.get(k)?.uci === uci });
  const fresh = items.filter((i) => i.fresh).length;
  return { due: items.length - fresh, fresh };
}
