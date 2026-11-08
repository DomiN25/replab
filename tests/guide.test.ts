import { describe, it, expect } from 'vitest';
import { buildGraph, pathSans, pathUcis, type GraphInput } from '../src/core/graph';
import { gapFamilies, nextGap, oppSiblings, openGapCount } from '../src/core/guide';
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

// Wie g, aber mit Eröffnungsnamen → Familien: e5 → Offene Spiele (…Sc6/…Sf6 erben), c5 → Sizilianisch, e6 → Französisch
const NAMES = new Map([
  [keyAfter(['e4', 'e5']), "King's Pawn Game"],
  // feinere Namen tiefer im Ast: dürfen den Ast nicht zerteilen
  [keyAfter(['e4', 'e5', 'Nf3', 'Nc6']), "King's Knight Opening: Normal Variation"],
  [keyAfter(['e4', 'e5', 'Nf3', 'Nf6']), 'Russian Game'],
  [keyAfter(['e4', 'c5']), 'Sicilian Defense'],
  [keyAfter(['e4', 'e6']), 'French Defense'],
]);
const gf = buildGraph({
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
  ecoName: (k) => NAMES.get(k),
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

  it('Ast für Ast: ohne Vorgeschichte der Ast mit der größten Erreichbarkeit, dort flach zuerst', () => {
    const node = (sans: string[]) => gf.nodes[gf.byPosKey.get(keyAfter(sans))!];
    // …Sc6 (40 %) + …Sf6 (10 %) liegen im selben Ast und wiegen zusammen mehr als 1…c5 (40 %) –
    // obwohl ihre Eröffnungsnamen (Königsspringerspiel, Russisch) verschieden sind
    expect(node(['e4', 'e5', 'Nf3', 'Nc6']).topFamily).toBe(node(['e4', 'e5', 'Nf3', 'Nf6']).topFamily);
    expect(node(['e4', 'e5', 'Nf3', 'Nc6']).family).not.toBe(node(['e4', 'e5', 'Nf3', 'Nf6']).family);
    const gp = nextGap(gf, { strategy: 'branch', minReach: 0, skipped: new Set() })!;
    expect(gp.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    // danach das Geschwister 2…Sf6 (10 %) vor dem häufigeren 1…c5 (40 %) – gleicher Ast
    const next = nextGap(gf, { strategy: 'branch', minReach: 0, skipped: new Set([gp.posKey]), lastFamily: gp.branch, lastPath: pathUcis(gf, gp.id) })!;
    expect(next.sans).toEqual(['e4', 'e5', 'Nf3', 'Nf6']);
  });

  it('Ast für Ast: bleibt im Ast der letzten Lücke, solange dort etwas offen ist', () => {
    const c5 = gf.nodes[gf.byPosKey.get(keyAfter(['e4', 'c5']))!];
    const gp = nextGap(gf, { strategy: 'branch', minReach: 0, skipped: new Set(), lastFamily: c5.topFamily, lastPath: pathUcis(gf, c5.id) })!;
    expect(gp.sans).toEqual(['e4', 'c5']);
    // Ast leer (c5 übersprungen) → zurück zum schwersten Ast
    const next = nextGap(gf, { strategy: 'branch', minReach: 0, skipped: new Set([c5.posKey]), lastFamily: c5.topFamily })!;
    expect(next.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('Ast-Filter: nur Lücken des gewählten Asts; Ast-Liste mit Anzahl', () => {
    const e6 = gf.nodes[gf.byPosKey.get(keyAfter(['e4', 'e6']))!];
    expect(openGapCount(gf, { minReach: 0, skipped: new Set(), family: e6.family })).toBe(1);
    expect(nextGap(gf, { strategy: 'shallow', minReach: 0, skipped: new Set(), family: e6.family })!.sans).toEqual(['e4', 'e6']);
    const fams = gapFamilies(gf, { minReach: 0, skipped: new Set() });
    expect(fams.reduce((s, f) => s + f.count, 0)).toBe(4);
    expect(fams[0].count).toBe(2);
    expect(new Set(fams.map((f) => f.family)).size).toBe(3);
  });

  it('Ast für Ast: bei gleicher Tiefe zuerst die ähnliche Linie (längster gemeinsamer Weg)', () => {
    // Zwei Gruppen gleich tiefer Lücken (Halbzug 6) im selben Ast: Spanisch (…a6, …Sf6) und Philidor (…exd4, …Sf6)
    const g2 = buildGraph({
      color: 'white',
      entries: entries([
        ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
        ['e4', 'e5', 'Nf3', 'd6', 'd4'],
      ]),
      marks: new Map(),
      explorer: new Map(
        [
          explorer(['e4'], [['e5', 1000]]),
          explorer(['e4', 'e5', 'Nf3'], [
            ['Nc6', 300],
            ['d6', 700],
          ]),
          explorer(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], [
            ['a6', 500],
            ['Nf6', 500],
          ]),
          explorer(['e4', 'e5', 'Nf3', 'd6', 'd4'], [
            ['exd4', 900],
            ['Nf6', 100],
          ]),
        ].map((x) => [x.posKey, x]),
      ),
      engine: new Map(),
      settings: SETTINGS,
      ecoName: (k) => (k === keyAfter(['e4', 'e5']) ? "King's Pawn Game" : undefined),
    });
    const fam = (sans: string[]) => g2.nodes[g2.byPosKey.get(keyAfter(sans))!].topFamily;
    const a6 = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];
    const exd4 = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'exd4'];
    expect(fam(a6)).toBe(fam(exd4)); // selber Ast – sonst prüfte der Test die Ast-Wahl statt der Ähnlichkeit
    const last = pathUcis(g2, g2.byPosKey.get(keyAfter(a6))!);
    const skipA6 = new Set([keyAfter(a6)]);
    // …exd4 (0,7 × 0,9 = 63 %) ist viel häufiger als 3…Sf6 im Spanier (0,3 × 0,5 = 15 %) –
    // nach …a6 kommt trotzdem die ähnliche Linie (Spanier): Ähnlichkeit schlägt Häufigkeit
    const gp = nextGap(g2, { strategy: 'branch', minReach: 0, skipped: skipA6, lastFamily: fam(a6), lastPath: last })!;
    expect(gp.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6']);
  });
});
