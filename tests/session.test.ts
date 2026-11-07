import { describe, it, expect } from 'vitest';
import {
  answer,
  createSession,
  currentStep,
  diversify,
  isFinished,
  lineDistance,
  type SessionItem,
} from '../src/core/session';
import { rng } from './helpers';

// Drei Linien (Spanisch, Sizilianisch, Französisch) mit je 4 aufeinander aufbauenden Karten
const LINES: Record<string, string[]> = {
  ruy: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5'],
  sic: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6', 'c1e3', 'e7e5'],
  fre: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4', 'e4e5', 'c7c5', 'a2a3', 'b4c3', 'b2c3', 'g8e7'],
};

function items(): SessionItem[] {
  const out: SessionItem[] = [];
  for (const [name, line] of Object.entries(LINES)) {
    for (let k = 1; k <= 4; k++) {
      const plies = 2 + 2 * k; // eigene Stellungen nach 4, 6, 8, 10 Halbzügen
      out.push({ cardId: `${name}${k}`, posKey: `${name}${k}`, path: line.slice(0, plies), priority: 0 });
    }
  }
  return out;
}

const maxSameLineRun = (order: SessionItem[], minDistance = 4) => {
  let run = 1;
  let worst = 1;
  for (let i = 1; i < order.length; i++) {
    run = lineDistance(order[i - 1].path, order[i].path) <= minDistance ? run + 1 : 1;
    worst = Math.max(worst, run);
  }
  return worst;
};

describe('Abstand zweier Karten', () => {
  it('Baumdistanz über den gemeinsamen Pfad', () => {
    expect(lineDistance(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(2); // Vorfahr
    expect(lineDistance(['a', 'b', 'x'], ['a', 'b', 'y'])).toBe(2); // Geschwister
    expect(lineDistance(['a'], ['b'])).toBe(2);
    expect(lineDistance(undefined, ['a'])).toBe(Infinity);
  });
});

describe('Keine Mehrfachabfrage derselben Linie am Stück', () => {
  it('über viele Zufallsseeds nie zwei Karten derselben Linie hintereinander', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const order = diversify(items(), 4, rng(seed));
      expect(order.length).toBe(12);
      expect(maxSameLineRun(order)).toBe(1);
    }
  });

  it('auch mit Prioritäten (Überfälligkeit) bleibt die Linie gemischt', () => {
    const its = items().map((it) => ({ ...it, priority: it.cardId.startsWith('ruy') ? 10 : 0 }));
    for (let seed = 1; seed <= 50; seed++) {
      expect(maxSameLineRun(diversify(its, 4, rng(seed)))).toBe(1);
    }
  });

  it('ungleich große Linien: Klumpen am Ende werden vermieden, solange möglich', () => {
    // 5 Karten Spanisch-Kette, 4 andere verteilt → 5 ≤ ceil(9/2) → lösbar
    const ruy = LINES.ruy;
    const its: SessionItem[] = [
      ...[4, 6, 8, 10, 12].map((p, i) => ({ cardId: `r${i}`, posKey: `r${i}`, path: ruy.slice(0, p), priority: 0 })),
      { cardId: 's', posKey: 's', path: LINES.sic.slice(0, 6), priority: 0 },
      { cardId: 'f', posKey: 'f', path: LINES.fre.slice(0, 6), priority: 0 },
      { cardId: 's2', posKey: 's2', path: LINES.sic.slice(0, 12), priority: 0 },
      { cardId: 'f2', posKey: 'f2', path: LINES.fre.slice(0, 12), priority: 0 },
    ];
    for (let seed = 1; seed <= 100; seed++) {
      expect(maxSameLineRun(diversify(its, 4, rng(seed)))).toBe(1);
    }
  });

  it('nur eine Linie vorhanden: alle Karten kommen trotzdem', () => {
    const its = items().filter((x) => x.cardId.startsWith('ruy'));
    expect(diversify(its, 4, rng(1)).length).toBe(4);
  });

  it('ohne Konflikte entscheidet die Priorität', () => {
    const its: SessionItem[] = [
      { cardId: 'a', posKey: 'a', path: LINES.ruy.slice(0, 6), priority: 1 },
      { cardId: 'b', posKey: 'b', path: LINES.sic.slice(0, 6), priority: 5 },
      { cardId: 'c', posKey: 'c', path: LINES.fre.slice(0, 6), priority: 3 },
    ];
    expect(diversify(its, 4, rng(1)).map((x) => x.cardId)).toEqual(['b', 'c', 'a']);
  });
});

describe('Sitzung und Relearning', () => {
  it('falsche Antwort → Karte genau einmal später erneut, nicht sofort', () => {
    const s = createSession('due', items(), { rand: rng(7) });
    const first = currentStep(s)!.cardId;
    const { relearnAt } = answer(s, false);
    expect(relearnAt).toBeGreaterThan(s.index); // nicht direkt als Nächstes
    expect(currentStep(s)!.cardId).not.toBe(first);
    // Rest richtig beantworten, Relearning-Versuch ebenfalls falsch
    while (!isFinished(s)) {
      const st = currentStep(s)!;
      answer(s, st.cardId === first ? false : true);
    }
    const shown = s.results.filter((r) => r.cardId === first);
    expect(shown.length).toBe(2); // Erstversuch + genau ein Relearning
    expect(shown.map((r) => r.attempt)).toEqual([1, 2]);
  });

  it('jede Karte höchstens zweimal pro Sitzung, auch wenn alles falsch ist', () => {
    const s = createSession('due', items(), { rand: rng(3) });
    while (!isFinished(s)) answer(s, false);
    const counts = new Map<string, number>();
    for (const r of s.results) counts.set(r.cardId, (counts.get(r.cardId) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(2);
    expect(counts.size).toBe(12);
  });

  it('Relearning landet nicht neben einer Karte derselben Linie (wenn vermeidbar)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createSession('due', items(), { rand: rng(seed) });
      answer(s, false);
      const order = s.steps.map((st) => s.items[st.cardId]);
      expect(maxSameLineRun(order)).toBe(1);
    }
  });

  it('Neu lernen: erst zeigen (Linienreihenfolge), dann gemischt abfragen', () => {
    const its = items();
    const s = createSession('new', its, { rand: rng(2) });
    expect(s.steps.slice(0, 12).every((st) => st.kind === 'show')).toBe(true);
    expect(s.steps.slice(0, 12).map((st) => st.cardId)).toEqual(its.map((x) => x.cardId));
    const asks = s.steps.slice(12).map((st) => s.items[st.cardId]);
    expect(maxSameLineRun(asks)).toBe(1);
  });

  it('Linien-Modus: Reihenfolge bleibt, kein Relearning', () => {
    const its = items().filter((x) => x.cardId.startsWith('sic'));
    const s = createSession('line', its);
    answer(s, false);
    expect(s.steps.length).toBe(4);
    expect(s.steps.map((x) => x.cardId)).toEqual(['sic1', 'sic2', 'sic3', 'sic4']);
  });
});
