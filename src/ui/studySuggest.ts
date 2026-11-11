// Studien-Vorschläge im Repertoire: Was spielt eine meiner Studien in der Stellung am Brett?
// Die Studienbäume werden einmal gebaut (nacheinander, damit die Oberfläche flüssig bleibt) und pro Studie gecacht.
import { useEffect, useState } from 'react';
import { buildStudyTree, cutKey, type StudyTree } from '../core/pgn';
import { activeChapters } from '../core/study';
import type { Color, Study } from '../core/types';
import { repo } from '../data/repo';
import { useInert } from './inert';

export interface SuggestMove {
  uci: string;
  san: string;
  comment?: string;
}
export interface StudySuggestion {
  studyId: string;
  studyName: string;
  moves: SuggestMove[];
}

interface Indexed {
  updatedAt: number;
  name: string;
  color: Color;
  tree: StudyTree;
  active: Set<number>;
  cuts: Set<string>;
}

const cache = new Map<string, Indexed>();

/** Vorschläge einer Stellung aus allen gebauten Studien der Farbe (aktive Kapitel, ohne entfernte Züge). */
export function suggestionsFor(posKey: string, color: Color): StudySuggestion[] {
  const out: StudySuggestion[] = [];
  for (const [studyId, ix] of cache) {
    if (ix.color !== color) continue;
    const node = ix.tree.nodes.get(posKey);
    if (!node) continue;
    const moves = node.moves
      .filter((m) => m.chapters.some((c) => ix.active.has(c)) && !ix.cuts.has(cutKey(posKey, m.uci)))
      .map((m) => ({ uci: m.uci, san: m.san, comment: m.comment }));
    if (moves.length) out.push({ studyId, studyName: ix.name, moves });
  }
  return out.sort((a, b) => a.studyName.localeCompare(b.studyName, 'de'));
}

/** Eine Studie in den Index aufnehmen (false bei defektem PGN). */
export function indexStudy(st: Study): boolean {
  try {
    const tree = buildStudyTree(st.pgn);
    cache.set(st.id, { updatedAt: st.updatedAt, name: st.name, color: st.color, tree, active: activeChapters(tree, st), cuts: new Set(st.cuts) });
    return true;
  } catch {
    return false; // keine Vorschläge aus dieser Studie
  }
}

export function clearStudyIndex() {
  cache.clear();
}

/** Studien der Farbe indexieren (einmal; Änderungen an der Studie → neu). Gibt true zurück, wenn sich etwas geändert hat. */
async function refreshIndex(color: Color, cancelled: () => boolean): Promise<boolean> {
  const list = (await repo.listStudies()).filter((s) => s.color === color);
  let changed = false;
  for (const id of [...cache.keys()]) {
    if (!list.some((s) => s.id === id)) {
      cache.delete(id);
      changed = true;
    }
  }
  for (const st of list) {
    if (cancelled()) return changed;
    const have = cache.get(st.id);
    if (have && have.updatedAt === st.updatedAt) continue;
    await new Promise((r) => setTimeout(r, 30)); // Luft für die Oberfläche
    changed = indexStudy(st) || changed;
  }
  return changed;
}

/** Vorschläge für die Stellung; baut den Index beim ersten Aufruf im Hintergrund auf. */
export function useStudySuggestions(posKey: string, color: Color): StudySuggestion[] {
  const [, setVersion] = useState(0); // erzwingt Neuzeichnen, sobald der Index fertig ist
  const inert = useInert();
  useEffect(() => {
    if (inert) return; // Vorschau-Seite: keinen Index aufbauen
    let dead = false;
    void refreshIndex(color, () => dead).then((changed) => {
      if (!dead && changed) setVersion((v) => v + 1);
    });
    return () => {
      dead = true;
    };
  }, [color, inert]);
  return suggestionsFor(posKey, color);
}
