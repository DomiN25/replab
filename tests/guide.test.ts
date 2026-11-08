import { describe, it, expect } from 'vitest';
import { buildGraph, pathSans, pathUcis, type GraphInput } from '../src/core/graph';
import { nextGap, oppSiblings, openGapCount } from '../src/core/guide';
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

// 1.e4: e5 (50 %), c5 (40 %), e6 (10 %) – nach 1…e5 2.Sf3: Sc6 (80 %), Sf6 (20 %)
const g = buildGraph({
  color: 'white',
  entries: entries([['e4', 'e5', 'Nf3']]),
  marks: new Map(),
  explorer: new Map(
    [
      explorer(['e4'], [
        ['e5', 500],
        ['c5', 400],
        ['e6', 100],
      ]),
      explorer(['e4', 'e5', 'Nf3'], [
        ['Nc6', 800],
        ['Nf6', 200],
      ]),
    ].map((x) => [x.posKey, x]),
  ),
  engine: new Map(),
  settings: SETTINGS,
});

describe('Geführter Aufbau: nächste Lücke', () => {
  it('flachste zuerst, bei gleicher Tiefe die häufigere', () => {
    const gp = nextGap(g, { strategy: 'shallow', minReach: 0, skipped: new Set() })!;
    expect(gp.sans).toEqual(['e4', 'c5']);
  });

  it('übersprungene Lücken werden ausgelassen', () => {
    const gp = nextGap(g, { strategy: 'shallow', minReach: 0, skipped: new Set([keyAfter(['e4', 'c5'])]) })!;
    expect(gp.sans).toEqual(['e4', 'e6']);
  });

  it('Mindest-Erreichbarkeit filtert seltene Lücken', () => {
    // e6 (10 %) und …Sf6 (0,5 × 0,2 = 10 %) fallen weg; c5 (40 %) und …Sc6 (0,5 × 0,8 = 40 %) bleiben
    expect(openGapCount(g, { minReach: 0.3, skipped: new Set() })).toBe(2);
    const gp = nextGap(g, { strategy: 'shallow', minReach: 0.3, skipped: new Set([keyAfter(['e4', 'c5'])]) })!;
    expect(gp.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('in der Linie bleiben: tiefer in der zuletzt bearbeiteten Linie weitermachen', () => {
    const last = pathUcis(g, g.byPosKey.get(keyAfter(['e4', 'e5', 'Nf3']))!);
    const gp = nextGap(g, { strategy: 'line', minReach: 0, skipped: new Set(), lastPath: last })!;
    expect(gp.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('keine Lücke mehr → undefined; Zähler', () => {
    const all = new Set(g.gaps.map((id) => g.nodes[id].posKey));
    expect(nextGap(g, { strategy: 'shallow', minReach: 0, skipped: all })).toBeUndefined();
    expect(openGapCount(g, { minReach: 0, skipped: new Set() })).toBe(4);
  });

  it('andere Gegnerzüge derselben Stellung mit Status', () => {
    const id = g.byPosKey.get(keyAfter(['e4', 'c5']))!;
    const sib = oppSiblings(g, id);
    expect(sib.map((s) => `${s.san}:${s.status}`)).toEqual(['e5:answered', 'c5:gap', 'e6:gap']);
    expect(pathSans(g, sib[0].id)).toEqual(['e4', 'e5']);
  });
});
