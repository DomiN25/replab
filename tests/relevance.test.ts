import { describe, it, expect } from 'vitest';
import { oppCandidates, myCandidates, formatEval, lineScore } from '../src/core/relevance';
import { SETTINGS, engine, explorer, fenAfter, mark } from './helpers';

const after = ['e4'];

describe('Relevanzregel Gegnerzüge (F3)', () => {
  it('Anteil ≥ 5 % und ≥ 20 Partien', () => {
    const ex = explorer(after, [
      ['e5', 500],
      ['c5', 400],
      ['e6', 60], // 6 %
      ['a6', 21], // 2,1 %
      ['Nc6', 19], // 1,9 %
    ]);
    const c = oppCandidates({ fen: fenAfter(after), explorer: ex, settings: SETTINGS });
    expect(c.filter((x) => x.relevant).map((x) => x.san)).toEqual(['e5', 'c5', 'e6']);
    expect(c.find((x) => x.san === 'e5')!.share).toBeCloseTo(0.5, 2);
  });

  it('Mindestpartien: 10 % Anteil, aber nur 15 Partien → nicht relevant', () => {
    const ex = explorer(after, [
      ['e5', 135],
      ['c5', 15],
    ]);
    const c = oppCandidates({ fen: fenAfter(after), explorer: ex, settings: SETTINGS });
    expect(c.find((x) => x.san === 'c5')!.relevant).toBe(false);
  });

  it('Engine-Regel: Top-3 und ≤ 50 cp vom Besten', () => {
    const en = engine(after, [
      ['c5', 30],
      ['e5', 20],
      ['e6', -10], // 40 cp schlechter → relevant
      ['d5', -25], // Rang 4 → nicht über Engine-Regel
    ]);
    const c = oppCandidates({ fen: fenAfter(after), engine: en, settings: SETTINGS });
    expect(c.filter((x) => x.relevant).map((x) => x.san).sort()).toEqual(['c5', 'e5', 'e6']);
  });

  it('Engine-Regel: Top-3, aber 60 cp schlechter → nicht relevant', () => {
    const en = engine(after, [
      ['c5', 30],
      ['e5', -30],
    ]);
    const c = oppCandidates({ fen: fenAfter(after), engine: en, settings: SETTINGS });
    expect(c.find((x) => x.san === 'e5')!.relevant).toBe(false);
    expect(c.find((x) => x.san === 'e5')!.lossCp).toBe(60);
  });

  it('extraOppMoves zählen, ignoredOppMoves nicht', () => {
    const ex = explorer(after, [
      ['e5', 500],
      ['c5', 400],
    ]);
    const m = mark(after, { extraOppMoves: ['b7b6'], ignoredOppMoves: ['c7c5'] });
    const c = oppCandidates({ fen: fenAfter(after), explorer: ex, mark: m, settings: SETTINGS });
    const rel = c.filter((x) => x.relevant).map((x) => x.san);
    expect(rel).toContain('b6');
    expect(rel).toContain('e5');
    expect(rel).not.toContain('c5');
    expect(c.find((x) => x.san === 'c5')!.ignored).toBe(true);
  });

  it('Falle: Anteil ≥ 10 % und ≥ 100 cp Verlust', () => {
    const pos = ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5'];
    const ex = explorer(pos, [
      ['d6', 600],
      ['Nxe4', 300],
      ['Qe7', 100],
    ]);
    const en = engine(pos, [
      ['d6', -30],
      ['Qe7', -60],
      ['Nxe4', -180],
    ]);
    const c = oppCandidates({ fen: fenAfter(pos), explorer: ex, engine: en, settings: SETTINGS });
    expect(c.find((x) => x.san === 'Nxe4')!.trap).toBe(true);
    expect(c.find((x) => x.san === 'Qe7')!.trap).toBe(false); // nur 30 cp
    expect(c.find((x) => x.san === 'd6')!.trap).toBe(false);
  });

  it('Fallen-Bewertung über die Folgestellung, wenn der Zug nicht in den Engine-Linien ist', () => {
    const pos = ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5'];
    const ex = explorer(pos, [
      ['d6', 700],
      ['Nxe4', 300],
    ]);
    const en = engine(pos, [['d6', -30]]);
    const child = engine([...pos, 'Nxe4'], [['Qe2', 200]]); // aus meiner Sicht +2,00
    const c = oppCandidates({
      fen: fenAfter(pos),
      explorer: ex,
      engine: en,
      childEngine: (k) => (k === child.posKey ? child : undefined),
      settings: SETTINGS,
    });
    const nxe4 = c.find((x) => x.san === 'Nxe4')!;
    expect(nxe4.moverCp).toBe(-200);
    expect(nxe4.lossCp).toBe(170);
    expect(nxe4.trap).toBe(true);
  });
});

describe('Kandidaten eigener Zug (F2)', () => {
  it('vereint Explorer und Engine, Δ zum Besten', () => {
    const pos = ['e4', 'c5'];
    const ex = explorer(pos, [
      ['Nf3', 800],
      ['Nc3', 200],
    ]);
    const en = engine(pos, [
      ['Nf3', 35],
      ['c3', 20],
    ]);
    const c = myCandidates(fenAfter(pos), ex, en);
    expect(c.map((x) => x.san)).toEqual(['Nf3', 'Nc3', 'c3']);
    expect(c.find((x) => x.san === 'c3')!.deltaCp).toBe(15);
    expect(c.find((x) => x.san === 'Nf3')!.share).toBeCloseTo(0.8);
  });
});

describe('Bewertungsanzeige', () => {
  it('formatiert cp und Matt', () => {
    expect(formatEval(35)).toBe('+0,35');
    expect(formatEval(-120)).toBe('−1,20');
    expect(formatEval(0)).toBe('0,00');
    expect(formatEval(undefined, 3)).toBe('#3');
    expect(formatEval(undefined, -2)).toBe('#−2');
    expect(lineScore({ mate: 1 })).toBeGreaterThan(lineScore({ mate: 3 }));
    expect(lineScore({ mate: -1 })).toBeLessThan(lineScore({ mate: -3 }));
  });
});
