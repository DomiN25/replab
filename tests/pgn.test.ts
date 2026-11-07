import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePgn, planImport, parseRepComment, exportPgn, readPgn, type ExistingEntry } from '../src/core/pgn';
import { buildGraph } from '../src/core/graph';
import { keyAfter, SETTINGS } from './helpers';

const seedPath = (f: string) => join(__dirname, '..', 'public', 'seed', f);
const seed = (f: string) => readFileSync(seedPath(f), 'utf8');
// Die Seed-PGNs sind privat (nicht im öffentlichen Repo) → Tests nur lokal, in CI übersprungen
const hasSeeds = existsSync(seedPath('repertoire_weiss.pgn'));
const itSeed = hasSeeds ? it : it.skip;

describe('Kommentar-Parser', () => {
  it('Name | Tiefe | Status | Plan', () => {
    const c = parseRepComment('Spanisch | Tiefe: tief | Status: noch zu lernen/festlegen | Hauptwaffe. Plan: c3, Te1.');
    expect(c).toEqual({ label: 'Spanisch', note: 'Hauptwaffe. Plan: c3, Te1.', tags: ['tief', 'prüfen'] });
  });

  it('LÜCKE-Kommentare werden ignoriert', () => {
    expect(parseRepComment('Pseudo-Trompowsky | LÜCKE: Antwort festlegen')).toEqual({ label: 'Pseudo-Trompowsky', note: undefined, tags: [] });
    expect(parseRepComment('LÜCKE: Antwort festlegen')).toEqual({ label: undefined, note: undefined, tags: [] });
  });

  it('kurzer Kommentar ohne Segmente = Label, langer Satz = Notiz', () => {
    expect(parseRepComment('Najdorf').label).toBe('Najdorf');
    const long = parseRepComment('Häufigster Zug deiner Gegner. Schwarz stützt e5, steht aber passiv.');
    expect(long.label).toBeUndefined();
    expect(long.note).toContain('Häufigster Zug');
  });

  it('ohne Namen nur Tags und Notiz', () => {
    const c = parseRepComment('Tiefe: flach | Status: noch zu lernen/festlegen | 3…cxd4 4.Dxd4! – Turm h8 hängt.');
    expect(c.label).toBeUndefined();
    expect(c.tags).toEqual(['flach', 'prüfen']);
    expect(c.note).toBe('3…cxd4 4.Dxd4! – Turm h8 hängt.');
  });
});

describe('PGN-Import', () => {
  itSeed('Seed Weiß: fehlerfrei, eigene Züge als Einträge, Gegnerzüge als extraOppMoves', () => {
    const text = seed('repertoire_weiss.pgn');
    const a = analyzePgn(text, 'white', new Map());
    expect(a.errors).toEqual([]);
    expect(a.conflicts).toEqual([]);
    const p = planImport(text, 'white', new Map());
    expect(p.errors).toEqual([]);
    expect(p.stats.newEntries).toBeGreaterThan(60);
    const e4 = p.entries.find((e) => e.san === 'e4')!;
    expect(e4.tags).toContain('tief');
    const bb5 = p.entries.find((e) => e.posKey === keyAfter(['e4', 'e5', 'Nf3', 'Nc6']))!;
    expect(bb5.san).toBe('Bb5');
    expect(bb5.note).toContain('Hauptwaffe');
    // Label „Spanisch“ an der Stellung nach 3.Lb5, „Najdorf“ nach 5…a6
    const labels = new Map(p.marks.map((m) => [m.posKey, m.label]));
    expect(labels.get(keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']))).toBe('Spanisch');
    expect(labels.get(keyAfter(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']))).toBe('Najdorf');
    // Gegnerzüge nach 1.e4
    const afterE4 = p.marks.find((m) => m.posKey === keyAfter(['e4']))!;
    expect(afterE4.extraOppMoves.length).toBeGreaterThanOrEqual(8);
  });

  itSeed('Seed Schwarz: fehlerfrei, LÜCKE-Stellungen ohne Eintrag', () => {
    const text = seed('repertoire_schwarz.pgn');
    const p = planImport(text, 'black', new Map());
    expect(p.errors).toEqual([]);
    expect(p.stats.newEntries).toBeGreaterThan(30);
    // 1.f4 (Bird) ist eine Lücke: Gegnerzug vorhanden, keine Antwort
    expect(p.entries.find((e) => e.posKey === keyAfter(['f4']))).toBeUndefined();
    const root = p.marks.find((m) => m.posKey === keyAfter([]))!;
    expect(root.extraOppMoves).toContain('f2f4');
    // Notizen enthalten keine LÜCKE-Texte
    expect(p.entries.every((e) => !(e.note ?? '').includes('LÜCKE'))).toBe(true);
  });

  itSeed('Studie Spanisch nach Seed Weiß: Konflikt 5.O-O vs 5.d3 wird erkannt', () => {
    const base = planImport(seed('repertoire_weiss.pgn'), 'white', new Map());
    const existing = new Map<string, ExistingEntry>(base.entries.map((e) => [e.posKey, { uci: e.uci, san: e.san, note: e.note, tags: e.tags }]));
    const text = seed('studie_spanisch.pgn');
    const a = analyzePgn(text, 'white', existing);
    expect(a.errors).toEqual([]);
    const k = keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
    const c = a.conflicts.find((x) => x.posKey === k)!;
    expect(c).toBeDefined();
    expect(c.options.map((o) => o.san)).toEqual(['O-O', 'd3']);
    expect(c.defaultUci).toBe('e1g1'); // Standard: Vorhandenes behalten

    // Standard: 5.O-O bleibt, 5.d3-Ast wird übersprungen
    const keep = planImport(text, 'white', existing);
    expect(keep.errors).toEqual([]);
    expect(keep.stats.skipped).toBeGreaterThan(0);
    // Stellung k bleibt unangetastet (5.O-O steht schon in der DB, wird nicht neu geplant)
    expect(keep.entries.find((e) => e.posKey === k)).toBeUndefined();
    expect(keep.entries.find((e) => e.posKey === keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'd3', 'Bc5']))).toBeUndefined();
    expect(keep.stats.newEntries).toBeGreaterThan(20);

    // Alternative: 5.d3 übernehmen → ersetzt
    const take = planImport(text, 'white', existing, new Map([[k, 'd2d3']]));
    const e = take.entries.find((x) => x.posKey === k)!;
    expect(e.san).toBe('d3');
    expect(e.status).toBe('replace');
    expect(take.entries.find((x) => x.posKey === keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'd3', 'Bc5']))).toBeDefined();
  });

  it('Konflikt innerhalb einer PGN: Standard = Hauptvariante', () => {
    const text = '[Event "x"]\n\n1. e4 e5 2. Nf3 (2. Bc4) *';
    const a = analyzePgn(text, 'white', new Map());
    expect(a.conflicts.length).toBe(1);
    expect(a.conflicts[0].defaultUci).toBe('g1f3');
    const p = planImport(text, 'white', new Map());
    expect(p.entries.map((e) => e.san)).toEqual(['e4', 'Nf3']);
  });

  it('Kommentare werden zu Notizen, vorhandene Notizen werden ergänzt, nicht ersetzt', () => {
    const existing = new Map<string, ExistingEntry>([[keyAfter([]), { uci: 'e2e4', san: 'e4', note: 'Alt' }]]);
    const p = planImport('1. e4 { Neue Idee: Zentrum besetzen. } *', 'white', existing);
    expect(p.entries[0].note).toBe('Alt\n\nNeue Idee: Zentrum besetzen.');
    expect(p.entries[0].status).toBe('update');
  });

  it('ungültige Züge werden gemeldet statt abzustürzen', () => {
    const p = planImport('1. e4 e5 2. Ke3 *', 'white', new Map());
    expect(p.errors.length).toBe(1);
    expect(p.entries.map((e) => e.san)).toEqual(['e4']);
  });

  itSeed('Studie Strukturen lässt sich parsen (8 Kapitel)', () => {
    expect(readPgn(seed('studie_strukturen.pgn')).length).toBe(8);
  });
});

describe('PGN-Export', () => {
  itSeed('Rundreise: Export → Import ergibt dieselben Einträge', () => {
    const text = seed('repertoire_weiss.pgn');
    const plan = planImport(text, 'white', new Map());
    const entries = new Map(plan.entries.map((e) => [e.posKey, { uci: e.uci, san: e.san }]));
    const marks = new Map(plan.marks.map((m) => [m.posKey, { repertoireId: 'r', posKey: m.posKey, extraOppMoves: m.extraOppMoves, label: m.label, updatedAt: 0 }]));
    const g = buildGraph({ color: 'white', entries, marks, explorer: new Map(), engine: new Map(), settings: SETTINGS });
    expect(g.orphans).toEqual([]);
    const out = exportPgn(g, {
      name: 'Test',
      notes: new Map(plan.entries.map((e) => [e.posKey, e.note])),
      labels: new Map(plan.marks.map((m) => [m.posKey, m.label])),
      extraOpp: new Map(plan.marks.map((m) => [m.posKey, m.extraOppMoves])),
    });
    expect(out).toContain('[Orientation "white"]');
    const again = planImport(out, 'white', new Map());
    expect(again.errors).toEqual([]);
    const a = new Set(plan.entries.map((e) => `${e.posKey}|${e.uci}`));
    const b = new Set(again.entries.map((e) => `${e.posKey}|${e.uci}`));
    expect([...a].filter((x) => !b.has(x))).toEqual([]);
    expect(b.size).toBe(a.size);
  });
});
