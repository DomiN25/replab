import { describe, it, expect } from 'vitest';
import { buildGraph, type GraphInput } from '../src/core/graph';
import { playSan, START_FEN } from '../src/core/chess';
import { newSrs } from '../src/core/srs';
import { buildPool, eligibleNew, newItems } from '../src/ui/training';
import { DEFAULT_SETTINGS, type Card, type Settings } from '../src/core/types';
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

// Weiß: 1.e4; gegen 1…e5 (80 %) 2.Sf3, gegen 1…c5 (15 %) 2.Sf3, gegen 1…a6 (5 %) 2.d4
const ent = entries([['e4', 'e5', 'Nf3'], ['e4', 'c5', 'Nf3'], ['e4', 'a6', 'd4']]);
const g = buildGraph({
  color: 'white',
  entries: ent,
  marks: new Map(),
  explorer: new Map([explorer(['e4'], [['e5', 800], ['c5', 150], ['a6', 50]])].map((x) => [x.posKey, x])),
  engine: new Map(),
  settings: SETTINGS,
});
const cards: Card[] = [...ent.keys()].map((posKey, i) => ({ id: 'c' + i, repertoireId: 'r', posKey, uci: ent.get(posKey)!.uci, srs: newSrs(0), createdAt: 0, updatedAt: 0 }));
const settings = (srs: Partial<Settings['srs']>): Settings => ({ ...DEFAULT_SETTINGS, srs: { ...DEFAULT_SETTINGS.srs, ...srs } });
const sansOf = (posKey: string) => {
  const id = g.byPosKey.get(posKey)!;
  return g.nodes[id].san ?? 'Start';
};

describe('Neue Karten', () => {
  const pool = buildPool(cards, [], DEFAULT_SETTINGS, Date.now(), g);

  it('wichtigste zuerst: nach Erreichbarkeit, Eltern vor Kindern', () => {
    const items = newItems(pool, settings({ newOrder: 'reach', newPerDay: 10 }), g);
    expect(items.map((i) => sansOf(i.posKey))).toEqual(['Start', 'e5', 'c5', 'a6']);
  });

  it('Tageslimit und Extra-Runde', () => {
    expect(newItems(pool, settings({ newPerDay: 2 }), g)).toHaveLength(2);
    expect(newItems(pool, settings({ newPerDay: 2 }), g, 10)).toHaveLength(4);
  });

  it('Mindest-Erreichbarkeit stellt seltene Stellungen zurück', () => {
    const s = settings({ newMinReach: 0.1 });
    expect(eligibleNew(pool, s, g).map((c) => sansOf(c.posKey))).toEqual(expect.arrayContaining(['Start', 'e5', 'c5']));
    expect(eligibleNew(pool, s, g)).toHaveLength(3); // 1…a6 (5 %) wartet
    expect(newItems(pool, s, g).map((i) => sansOf(i.posKey))).not.toContain('a6');
  });
});
