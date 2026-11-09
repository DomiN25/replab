import { describe, it, expect } from 'vitest';
import { buildGraph, type GraphInput } from '../src/core/graph';
import { playSan, START_FEN } from '../src/core/chess';
import { lineLabel, looksLikeMoves, normalizeSanToken, searchGraph } from '../src/core/search';
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

const NAMES = new Map([
  [keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), 'Ruy Lopez'],
  [keyAfter(['e4', 'c5']), 'Sicilian Defense'],
]);
const g = buildGraph({
  color: 'white',
  entries: entries([
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    ['e4', 'c5', 'Nf3'],
  ]),
  marks: new Map(),
  explorer: new Map(
    [
      explorer(['e4'], [['e5', 600], ['c5', 400]]),
      explorer(['e4', 'e5', 'Nf3'], [['Nc6', 1000]]),
      explorer(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], [['a6', 700], ['Nf6', 300]]),
    ].map((x) => [x.posKey, x]),
  ),
  engine: new Map(),
  settings: SETTINGS,
  ecoName: (k) => NAMES.get(k),
});
const idOf = (sans: string[]) => g.byPosKey.get(keyAfter(sans))!;

describe('Suche im Repertoire', () => {
  it('Zugtokens: deutsch → englisch, Zugnummern weg', () => {
    expect(normalizeSanToken('3.Lb5')).toBe('Bb5');
    expect(normalizeSanToken('2…Sc6')).toBe('Nc6');
    expect(normalizeSanToken('e8=D')).toBe('e8=Q');
    expect(normalizeSanToken('0-0')).toBe('O-O');
    expect(looksLikeMoves('Lb5 a6')).toBe(true);
    expect(looksLikeMoves('Spanisch')).toBe(false);
  });

  it('Zugfolge findet die Stellung nach den Zügen', () => {
    const hits = searchGraph(g, 'Lb5 a6');
    expect(hits[0]).toEqual({ id: idOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']), kind: 'line' });
    expect(searchGraph(g, '3.Lb5').map((h) => h.id)).toContain(idOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']));
  });

  it('Eröffnungsname: nur die flachste Stellung je Name', () => {
    const hits = searchGraph(g, 'spanisch');
    expect(hits.filter((h) => h.kind === 'name')).toHaveLength(1);
    expect(hits[0].id).toBe(idOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']));
  });

  it('Notizen und eigene Namen', () => {
    const notes = new Map([[keyAfter(['e4', 'c5']), 'Gegen Sizilianisch spiele ich das offene Sizilianisch mit 2.Sf3.']]);
    const labels = new Map([[keyAfter(['e4']), 'Meine Weiß-Basis']]);
    const n = searchGraph(g, 'offene', { notes });
    expect(n[0].kind).toBe('note');
    expect(n[0].text).toContain('offene');
    expect(searchGraph(g, 'basis', { labels })[0]).toMatchObject({ kind: 'label', id: idOf(['e4']) });
  });

  it('Trefferzeile mit Zugnummern', () => {
    expect(lineLabel(g, idOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']), 'de')).toBe('1.e4 e5 2.Sf3 Sc6 3.Lb5 a6');
    expect(lineLabel(g, idOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']), 'de', 3)).toBe('… 2…Sc6 3.Lb5 a6');
  });
});
