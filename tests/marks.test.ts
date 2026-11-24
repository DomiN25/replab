import { describe, it, expect } from 'vitest';
import { buildGraph, type GraphInput } from '../src/core/graph';
import { importantRetention, markedLines } from '../src/core/marks';
import { playSan, START_FEN } from '../src/core/chess';
import { SETTINGS, explorer, keyAfter } from './helpers';

function entries(lines: string[][]): GraphInput['entries'] {
  const m: GraphInput['entries'] = new Map();
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

const g = buildGraph({
  color: 'white',
  entries: entries([['e4', 'e5', 'Nf3'], ['e4', 'c5', 'c3']]),
  marks: new Map(),
  explorer: new Map([explorer(['e4'], [['e5', 500], ['c5', 400]])].map((x) => [x.posKey, x])),
  engine: new Map(),
  settings: SETTINGS,
});

describe('Markierte Linien', () => {
  it('Markierung gilt für die Linie darunter, nicht für Geschwister', () => {
    const m = markedLines(g, [{ repertoireId: 'r', posKey: keyAfter(['e4', 'c5']), critical: true, updatedAt: 0 }]);
    expect(m.important.has(keyAfter(['e4', 'c5']))).toBe(true);
    expect(m.important.has(keyAfter(['e4', 'c5', 'c3']))).toBe(true);
    expect(m.important.has(keyAfter(['e4', 'e5']))).toBe(false);
    expect(m.sharp.size).toBe(0);
  });
  it('spannend getrennt von wichtig; ohne Graph nur die Stellung selbst', () => {
    const m = markedLines(undefined, [{ repertoireId: 'r', posKey: 'x', sharp: true, updatedAt: 0 }]);
    expect([...m.sharp]).toEqual(['x']);
    expect(m.important.size).toBe(0);
  });
  it('höhere Ziel-Erinnerung, gedeckelt', () => {
    expect(importantRetention(0.9)).toBeCloseTo(0.95);
    expect(importantRetention(0.95)).toBe(0.97);
  });
});
