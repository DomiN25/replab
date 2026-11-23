import { describe, it, expect } from 'vitest';
import { bestWorst, errorSpots, openingStats } from '../src/core/openingStats';
import type { GameRec } from '../src/core/opponentStats';
import type { GameReview } from '../src/core/gameReview';

const g = (c: 'w' | 'b', r: 1 | 0 | -1, m = 'e4 e5'): GameRec => ({ c, r, m });
const fam: Record<string, string> = { a: 'Italienisch', b: 'Italienisch', c: 'Sizilianisch', d: 'Sizilianisch', e: 'Sizilianisch', f: 'Französisch', x: 'Italienisch' };

describe('Eröffnungs-Statistik', () => {
  const games = [
    { key: 'a', game: g('w', 1) },
    { key: 'b', game: g('w', 0) },
    { key: 'x', game: g('w', 1) },
    { key: 'c', game: g('w', -1) },
    { key: 'd', game: g('w', -1) },
    { key: 'e', game: g('w', 0) },
    { key: 'f', game: g('b', 1) },
  ];
  it('openingStats: je Farbe und Familie, Punkte, „schlechter danach“', () => {
    const s = openingStats(games, 'w', (k) => fam[k], (k) => k === 'c');
    expect(s.map((x) => x.family)).toEqual(['Italienisch', 'Sizilianisch']);
    expect(s[0]).toMatchObject({ n: 3, w: 2, d: 1, l: 0, score: 83 });
    expect(s[1]).toMatchObject({ n: 3, w: 0, d: 1, l: 2, score: 17, flagged: 1 });
    expect(openingStats(games, 'b', (k) => fam[k])).toEqual([expect.objectContaining({ family: 'Französisch', n: 1, score: 100 })]);
  });
  it('bestWorst: nur ab Mindestanzahl', () => {
    const s = openingStats(games, 'w', (k) => fam[k]);
    expect(bestWorst(s).best?.family).toBe('Italienisch');
    expect(bestWorst(s).worst?.family).toBe('Sizilianisch');
    expect(bestWorst(s, 4)).toEqual({});
  });
});

describe('Häufigste Fehlerstellen', () => {
  const rev = (status: GameReview['status'], ply?: number, mistake?: GameReview['mistake']): GameReview => ({ status, ply, inRepPlies: ply ?? 0, prefix: [], mistake });
  it('fasst gleiche Zugfolgen zusammen, häufigste zuerst, mit Ø-Bewertung', () => {
    const items = [
      { key: '1', game: g('w', -1, 'e4 e5 Bc4 Nf6'), rev: rev('my-deviation', 2), a: { cp: -100, verdict: 'flag' as const, label: '' } },
      { key: '2', game: g('w', 0, 'e4 e5 Bc4 Nc6'), rev: rev('my-deviation', 2), a: { cp: -80, verdict: 'flag' as const, label: '' } },
      { key: '3', game: g('w', 1, 'e4 d5 exd5'), rev: rev('opp-new', 1), a: { cp: 50, verdict: 'eq' as const, label: '' } },
      { key: '4', game: g('w', -1, 'e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5'), rev: rev('in-rep', undefined, { ply: 6, san: 'Nxe5', drop: 300 }) },
    ];
    const s = errorSpots(items);
    expect(s[0]).toMatchObject({ kind: 'dev', n: 2, avgCp: -90, sans: ['e4', 'e5', 'Bc4'], keys: ['1', '2'] });
    expect(s[1]).toMatchObject({ kind: 'mistake', n: 1, avgCp: -300, ply: 6 });
    expect(s.find((x) => x.kind === 'opp')).toBeUndefined(); // ausgeglichen → kein Fehler
  });
});
