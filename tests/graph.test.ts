import { describe, it, expect } from 'vitest';
import { buildGraph, gapList, groupGaps, lineOrder, pathSans, type GraphInput } from '../src/core/graph';
import { playSan, playUci, posKeyOf, START_FEN } from '../src/core/chess';
import { SETTINGS, explorer, engine, keyAfter, legalUcis, mark, rng } from './helpers';
import type { EngineData, ExplorerData, PositionMark } from '../src/core/types';

type Entries = GraphInput['entries'];

function entries(lines: string[][]): Entries {
  // Jede Linie: SAN-Folge ab Grundstellung; die eigenen Züge (Weiß: gerade Indizes) werden Einträge.
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

function input(
  e: Entries,
  ex: ExplorerData[] = [],
  marks: PositionMark[] = [],
  en: EngineData[] = [],
  color: 'white' | 'black' = 'white',
): GraphInput {
  return {
    color,
    entries: e,
    marks: new Map(marks.map((m) => [m.posKey, m])),
    explorer: new Map(ex.map((x) => [x.posKey, x])),
    engine: new Map(en.map((x) => [x.posKey, x])),
    settings: SETTINGS,
  };
}

const exE4 = explorer(['e4'], [
  ['e5', 500],
  ['c5', 400],
  ['e6', 60],
  ['a6', 20],
]);

describe('Graph und Lücken', () => {
  it('relevante Gegnerzüge ohne Antwort sind Lücken', () => {
    const g = buildGraph(input(entries([['e4']]), [exE4]));
    const gaps = gapList(g);
    expect(gaps.map((x) => x.sans.join(' '))).toEqual(['e4 e5', 'e4 c5', 'e4 e6']);
    expect(gaps[0].reach).toBeCloseTo(0.51, 2);
  });

  it('Lücke verschwindet nach Festlegen, Folgestellung wartet auf Daten', () => {
    const g = buildGraph(input(entries([['e4', 'e5', 'Nf3']]), [exE4]));
    const gaps = gapList(g).map((x) => x.sans.join(' '));
    expect(gaps).not.toContain('e4 e5');
    expect(gaps).toEqual(['e4 c5', 'e4 e6']);
    const pending = g.pending.map((id) => pathSans(g, id).join(' '));
    expect(pending).toContain('e4 e5 Nf3');
  });

  it('neue Lücken erscheinen, sobald die Explorer-Daten der Folgestellung da sind', () => {
    const exNf3 = explorer(['e4', 'e5', 'Nf3'], [
      ['Nc6', 700],
      ['Nf6', 200],
      ['d6', 100],
    ]);
    const g = buildGraph(input(entries([['e4', 'e5', 'Nf3']]), [exE4, exNf3]));
    const gaps = gapList(g).map((x) => x.sans.join(' '));
    expect(gaps).toEqual(expect.arrayContaining(['e4 e5 Nf3 Nc6', 'e4 e5 Nf3 Nf6', 'e4 e5 Nf3 d6']));
    expect(g.pending.length).toBe(0);
  });

  it('Ende-Marker unterdrückt Lücken (eigene Stellung und Gegnerstellung)', () => {
    const g = buildGraph(input(entries([['e4']]), [exE4], [mark(['e4', 'e6'], { endOfLine: true })]));
    expect(gapList(g).map((x) => x.sans.join(' '))).toEqual(['e4 e5', 'e4 c5']);
    const g2 = buildGraph(input(entries([['e4']]), [exE4], [mark(['e4'], { endOfLine: true })]));
    expect(g2.gaps.length).toBe(0);
  });

  it('ignorierte Gegnerzüge erzeugen keine Lücke, zusätzliche schon', () => {
    const g = buildGraph(
      input(entries([['e4']]), [exE4], [mark(['e4'], { ignoredOppMoves: ['e7e6'], extraOppMoves: ['g7g6'] })]),
    );
    const gaps = gapList(g).map((x) => x.sans.join(' '));
    expect(gaps).not.toContain('e4 e6');
    expect(gaps).toContain('e4 g6');
  });

  it('Zugumstellung: zweite Fundstelle wird Verweisknoten, keine doppelte Lücke', () => {
    // 1.e4 c5 2.Nf3 d6 3.d4  und  1.Nf3 c5 2.e4 d6 3.d4 → gleiche Stellung
    const e = entries([['e4', 'c5', 'Nf3', 'd6', 'd4']]);
    const g = buildGraph(
      input(
        e,
        [explorer(['e4'], [['c5', 1000]]), explorer(['e4', 'c5', 'Nf3'], [['d6', 1000]])],
        [],
        [],
      ),
    );
    const key = keyAfter(['e4', 'c5', 'Nf3', 'd6', 'd4']);
    expect(g.byPosKey.has(key)).toBe(true);
    // Zweiter Weg über Extra-Züge in einem zweiten Graphen mit 1.Nf3-Start ist nicht Teil dieses Repertoires;
    // daher direkt: Transposition innerhalb des Repertoires (Schwarz spielt ...d6 und ...e6 in anderer Reihenfolge)
    const e2 = entries([
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6'],
      ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6'],
    ]);
    const exs = [
      explorer(['e4'], [['c5', 1000]]),
      explorer(['e4', 'c5', 'Nf3'], [
        ['d6', 600],
        ['e6', 400],
      ]),
      explorer(['e4', 'c5', 'Nf3', 'd6', 'd4'], [['cxd4', 1000]]),
      explorer(['e4', 'c5', 'Nf3', 'e6', 'd4'], [['cxd4', 1000]]),
      explorer(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'], [['Nf6', 1000]]),
      explorer(['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4'], [['Nf6', 1000]]),
      explorer(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], [['e6', 1000]]),
      explorer(['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], [['d6', 1000]]),
    ];
    const g2 = buildGraph(input(e2, exs));
    const sch = keyAfter(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6']);
    const occurrences = g2.nodes.filter((n) => n.posKey === sch);
    expect(occurrences.length).toBe(2);
    expect(occurrences.filter((n) => n.status === 'transposition').length).toBe(1);
    const t = occurrences.find((n) => n.status === 'transposition')!;
    expect(t.transposeOf).toBe(g2.byPosKey.get(sch));
    // genau eine Lücke für die Scheveningen-Stellung, nicht zwei
    expect(g2.gaps.filter((id) => g2.nodes[id].posKey === sch).length).toBe(1);
    // Erreichwahrscheinlichkeit summiert beide Wege: 0,6 + 0,4 = 1
    expect(g2.nodes[g2.byPosKey.get(sch)!].reach).toBeCloseTo(1, 5);
  });

  it('Erreichwahrscheinlichkeit = Produkt der Gegner-Anteile', () => {
    const g = buildGraph(
      input(entries([['e4', 'e5', 'Nf3']]), [
        explorer(['e4'], [
          ['e5', 500],
          ['c5', 500],
        ]),
        explorer(['e4', 'e5', 'Nf3'], [
          ['Nc6', 800],
          ['Nf6', 200],
        ]),
      ]),
    );
    const id = g.byPosKey.get(keyAfter(['e4', 'e5', 'Nf3', 'Nc6']))!;
    expect(g.nodes[id].reach).toBeCloseTo(0.4, 5);
  });

  it('verwaiste Einträge werden erkannt', () => {
    const e = entries([['e4', 'e5', 'Nf3']]);
    e.set(keyAfter(['d4', 'd5']), { uci: 'c2c4', san: 'c4' });
    const g = buildGraph(input(e, [exE4]));
    expect(g.orphans).toEqual([keyAfter(['d4', 'd5'])]);
  });

  it('Schwarz-Repertoire: Wurzel ist Gegnerstellung', () => {
    const exStart: ExplorerData = explorer([], [
      ['e4', 600],
      ['d4', 400],
    ]);
    const e: Entries = new Map([[keyAfter(['e4']), { uci: 'c7c5', san: 'c5' }]]);
    const g = buildGraph(input(e, [exStart], [], [], 'black'));
    expect(g.nodes[0].toMove).toBe('opp');
    expect(gapList(g).map((x) => x.sans.join(' '))).toEqual(['d4']);
  });

  it('tiefe Linie ohne Partien: nur Engine-Regel, Hinweis needsEngine', () => {
    const line = ['e4', 'e5', 'Nf3'];
    const ex0 = explorer(line, []); // keine Partien
    const g = buildGraph(input(entries([line]), [explorer(['e4'], [['e5', 100]]), ex0]));
    expect(g.needsEngine.map((id) => pathSans(g, id).join(' '))).toEqual(['e4 e5 Nf3']);
    const en = engine(line, [
      ['Nc6', -30],
      ['Nf6', -45],
      ['d6', -120],
    ]);
    const g2 = buildGraph(input(entries([line]), [explorer(['e4'], [['e5', 100]]), ex0], [], [en]));
    expect(gapList(g2).map((x) => x.sans.at(-1))).toEqual(['Nc6', 'Nf6']);
  });

  it('Lücken nach Familie gruppiert (Explorer-Name, übersetzt)', () => {
    const g = buildGraph(
      input(entries([['e4']]), [
        explorer(['e4'], [
          ['e5', 500],
          ['c5', 500],
        ]),
        { ...explorer(['e4', 'c5'], []), opening: { eco: 'B20', name: 'Sicilian Defense' } },
        { ...explorer(['e4', 'e5'], []), opening: { eco: 'C20', name: "King's Pawn Game" } },
      ]),
    );
    const groups = groupGaps(gapList(g)).map((x) => x.family).sort();
    expect(groups).toEqual(['Offene Spiele', 'Sizilianisch']);
  });

  it('Linien-Reihenfolge: Tiefensuche, häufigere Gegnerzüge zuerst', () => {
    const e = entries([
      ['e4', 'e5', 'Nf3'],
      ['e4', 'c5', 'Nf3'],
    ]);
    const g = buildGraph(
      input(e, [
        explorer(['e4'], [
          ['c5', 600],
          ['e5', 400],
        ]),
      ]),
    );
    const order = lineOrder(g).map((id) => pathSans(g, id).join(' '));
    expect(order).toEqual(['', 'e4 c5', 'e4 e5']);
  });

  it('Leistung: ~6.500 Knoten in unter 2 s', () => {
    // Synthetisches Repertoire: eigener Zug = erster legaler Zug, Gegner: 3 Extra-Züge
    const e: Entries = new Map();
    const marks: PositionMark[] = [];
    const rand = rng(42);
    const pick = (arr: string[], n: number) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, n);
    };
    const build = (fen: string, depth: number) => {
      if (depth === 0) return;
      const p = playUci(fen, pick(legalUcis(fen), 1)[0]);
      e.set(posKeyOf(fen), { uci: p.uci, san: p.san });
      const opp = pick(legalUcis(p.fen), 3);
      marks.push({ repertoireId: 'r', posKey: p.posKey, extraOppMoves: opp, updatedAt: 0 });
      for (const o of opp) build(playUci(p.fen, o).fen, depth - 1);
    };
    build(START_FEN, 7);
    const t0 = performance.now();
    const g = buildGraph(input(e, [], marks));
    const ms = performance.now() - t0;
    console.log(`Graph: ${g.nodes.length} Knoten in ${ms.toFixed(0)} ms`);
    expect(g.nodes.length).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(2000);
  });
});
