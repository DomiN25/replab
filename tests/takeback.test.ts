import { describe, it, expect } from 'vitest';
import { buildGraph, type GraphInput } from '../src/core/graph';
import { playSan, START_FEN } from '../src/core/chess';
import { takebackKeys } from '../src/core/takeback';
import { SETTINGS, explorer, keyAfter } from './helpers';
import type { ExplorerData } from '../src/core/types';

type Entries = GraphInput['entries'];

function entries(lines: string[][]): Entries {
  const m: Entries = new Map();
  for (const line of lines) {
    let fen = START_FEN;
    line.forEach((san, i) => {
      const p = playSan(fen, san)!;
      if (i % 2 === 0) m.set(keyAfter(line.slice(0, i)), { uci: p.uci, san: p.san });
      fen = p.fen;
    });
  }
  return m;
}

const graph = (e: Entries, ex: ExplorerData[]) =>
  buildGraph({ color: 'white', entries: e, marks: new Map(), explorer: new Map(ex.map((x) => [x.posKey, x])), engine: new Map(), settings: SETTINGS });

const EX = [
  explorer(['e4'], [['e5', 500], ['c5', 400], ['Nc6', 100]]),
  explorer(['e4', 'e5', 'Nf3'], [['Nc6', 500]]),
  explorer(['e4', 'Nc6', 'Nf3'], [['e5', 500]]),
  explorer(['e4', 'c5', 'Nf3'], [['d6', 500]]),
];

describe('Zug zurücknehmen', () => {
  const e = entries([
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    ['e4', 'c5', 'Nf3', 'd6', 'd4'],
    ['e4', 'Nc6', 'Nf3', 'e5'],
  ]);
  const g = graph(e, EX);

  it('erster Zug: alles darunter fällt mit weg', () => {
    const keys = takebackKeys(g, keyAfter([]), e.keys());
    expect(keys[0]).toBe(keyAfter([]));
    expect(new Set(keys)).toEqual(new Set(e.keys()));
  });

  it('nur der Ast unter dem Zug, Nachbaräste bleiben', () => {
    const keys = takebackKeys(g, keyAfter(['e4', 'c5']), e.keys());
    expect(new Set(keys)).toEqual(new Set([keyAfter(['e4', 'c5']), keyAfter(['e4', 'c5', 'Nf3', 'd6'])]));
  });

  it('Zugumstellung: über einen anderen Weg erreichbare Einträge bleiben', () => {
    // 1.e4 e5 2.Nf3 Nc6 entsteht auch über 1.e4 Nc6 2.Nf3 e5 → 3.Lc4 bleibt erhalten
    const keys = takebackKeys(g, keyAfter(['e4', 'e5']), e.keys());
    expect(keys).toEqual([keyAfter(['e4', 'e5'])]);
  });

  it('letzter Zug einer Linie: nur er selbst', () => {
    expect(takebackKeys(g, keyAfter(['e4', 'c5', 'Nf3', 'd6']), e.keys())).toEqual([keyAfter(['e4', 'c5', 'Nf3', 'd6'])]);
  });

  it('schon verwaiste Einträge zählen nicht mit', () => {
    const withOrphan = new Map(e);
    withOrphan.set(keyAfter(['d4', 'd5']), { uci: 'c2c4', san: 'c4' });
    const keys = takebackKeys(graph(withOrphan, EX), keyAfter([]), withOrphan.keys());
    expect(keys).not.toContain(keyAfter(['d4', 'd5']));
  });
});
