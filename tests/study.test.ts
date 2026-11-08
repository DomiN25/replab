import { describe, it, expect } from 'vitest';
import { buildStudyTree, cutKey, planImport, type ExistingEntry } from '../src/core/pgn';
import { activeChapters, firstExcluded, nextUnseen, nodeView, readingOrder, studyFilter, subtreeSize } from '../src/core/study';
import type { Study } from '../src/core/types';
import { keyAfter } from './helpers';

// Schwarz-Studie: Kapitel 1 mit zwei eigenen Antworten auf 3.Lb5 (3…e5 Hauptvariante, 3…g6 Nebenvariante),
// Kapitel 2 (Alapin) über Zugumstellung in derselben Stellung nach 1.e4 c5, Kapitel 3 ist für Weiß.
const PGN = `[Event "K1"]
[ChapterName "Rossolimo"]

{ Einleitung zum Kurs }
1. e4 c5 2. Nf3 Nc6 3. Bb5 e5 { Meine Wahl. } (3... g6 4. O-O Bg7) 4. O-O d6 *

[Event "K2"]
[ChapterName "Alapin"]

1. e4 c5 2. c3 e5 3. Nf3 Nc6 *

[Event "K3"]
[ChapterName "Fremd"]
[Orientation "white"]

1. d4 d5 2. c4 *
`;

const tree = buildStudyTree(PGN);
const study = (p: Partial<Study> = {}): Study => ({
  id: 's',
  name: 'Test',
  color: 'black',
  pgn: PGN,
  choices: {},
  cuts: [],
  skipChapters: [],
  createdAt: 0,
  updatedAt: 0,
  ...p,
});
const noRep = new Map<string, ExistingEntry>();
const kBb5 = keyAfter(['e4', 'c5', 'Nf3', 'Nc6', 'Bb5']);

describe('Studienbaum', () => {
  it('führt Kapitel zusammen, liest Namen, Einleitung und Kommentare', () => {
    expect(tree.chapters.map((c) => c.name)).toEqual(['Rossolimo', 'Alapin', 'Fremd']);
    expect(tree.chapters[0].intro).toContain('Einleitung');
    expect(tree.chapters[2].color).toBe('white');
    const afterC5 = tree.nodes.get(keyAfter(['e4', 'c5']))!;
    expect(afterC5.moves.map((m) => m.san)).toEqual(['Nf3', 'c3']); // aus zwei Kapiteln
    const bb5 = tree.nodes.get(kBb5)!;
    expect(bb5.moves.find((m) => m.san === 'e5')!.comment).toBe('Meine Wahl.');
  });

  it('Kapitel der anderen Farbe zählen nicht', () => {
    const active = activeChapters(tree, study());
    expect([...active]).toEqual([0, 1]);
    const root = nodeView(tree.nodes.get(tree.root)!, study(), active, noRep);
    expect(root.moves.map((m) => m.san)).toEqual(['e4']); // 1.d4 (Weiß-Kapitel) ausgeblendet
  });
});

describe('Auswahl wie beim Import', () => {
  const active = activeChapters(tree, study());

  it('Standard: Hauptvariante; Nebenvariante wird nicht übernommen', () => {
    const v = nodeView(tree.nodes.get(kBb5)!, study(), active, noRep);
    expect(v.mine).toBe(true);
    expect(v.chosen).toBe('e7e5');
    expect(v.moves.map((m) => `${m.san}:${m.status}`)).toEqual(['e5:chosen', 'g6:alt']);
  });

  it('vorhandener Repertoirezug gewinnt – auch wenn die Studie ihn nicht kennt', () => {
    const rep = new Map<string, ExistingEntry>([[kBb5, { uci: 'g7g6', san: 'g6' }]]);
    expect(nodeView(tree.nodes.get(kBb5)!, study(), active, rep).chosen).toBe('g7g6');
    const other = new Map<string, ExistingEntry>([[kBb5, { uci: 'e7e6', san: 'e6' }]]);
    const v = nodeView(tree.nodes.get(kBb5)!, study(), active, other);
    expect(v.chosen).toBe('e7e6');
    expect(v.moves.every((m) => m.status === 'alt')).toBe(true);
  });

  it('eigene Wahl überstimmt; Pfad durch nicht gewählten Zug ist ausgeschlossen', () => {
    const st = study({ choices: { [kBb5]: 'g7g6' } });
    expect(nodeView(tree.nodes.get(kBb5)!, st, active, noRep).chosen).toBe('g7g6');
    const path = [
      { key: tree.root, uci: 'e2e4' },
      { key: keyAfter(['e4']), uci: 'c7c5' },
      { key: keyAfter(['e4', 'c5']), uci: 'g1f3' },
      { key: keyAfter(['e4', 'c5', 'Nf3']), uci: 'b8c6' },
      { key: keyAfter(['e4', 'c5', 'Nf3', 'Nc6']), uci: 'f1b5' },
      { key: kBb5, uci: 'e7e5' },
    ];
    expect(firstExcluded(tree, path, st, active, noRep)).toEqual({ index: 5, reason: 'alt' });
    expect(firstExcluded(tree, path, study(), active, noRep)).toBeUndefined();
  });

  it('Ast entfernen und Kapitel abwählen wirken auf den Übernahme-Plan', () => {
    const full = planImport(PGN, 'black', noRep, new Map(), undefined, studyFilter(study()));
    // 1…c5, 2…Sc6, 3…e5, 4…d6 (K1) + 2…e5, 3…Sc6 (K2)
    expect(full.entries.map((e) => e.san).sort()).toEqual(['Nc6', 'Nc6', 'c5', 'd6', 'e5', 'e5']);
    const cutAlapin = study({ cuts: [cutKey(keyAfter(['e4', 'c5']), 'c2c3')] });
    const p1 = planImport(PGN, 'black', noRep, new Map(), undefined, studyFilter(cutAlapin));
    expect(p1.entries.map((e) => e.san).sort()).toEqual(['Nc6', 'c5', 'd6', 'e5']);
    const skipK1 = planImport(PGN, 'black', noRep, new Map(), undefined, studyFilter(study({ skipChapters: [0] })));
    expect(skipK1.entries.map((e) => e.san).sort()).toEqual(['Nc6', 'c5', 'e5']);
    const choice = planImport(PGN, 'black', noRep, new Map([[kBb5, 'g7g6']]), undefined, studyFilter(study()));
    expect(choice.entries.map((e) => e.san)).toContain('Bg7'); // Nebenvariante gewählt → ihr Ast kommt mit
  });

  it('Teilbaumgröße für die Rückfrage beim Entfernen', () => {
    expect(subtreeSize(tree, keyAfter(['e4', 'c5', 'c3']), active)).toBe(4); // nach 2.c3: …e5, 3.Sf3, …Sc6
  });
});

describe('Durcharbeiten', () => {
  const active = activeChapters(tree, study());
  const order = readingOrder(tree, study(), active);
  const sanPath = (path: { key: string; uci: string }[]) =>
    path.map((p) => tree.nodes.get(p.key)!.moves.find((m) => m.uci === p.uci)!.san).join(' ');

  it('Lesereihenfolge: Hauptvariante zuerst, dann die Nebenvarianten', () => {
    const lines = order.map((x) => sanPath(x.path));
    expect(lines[0]).toBe('');
    expect(lines.indexOf('e4 c5 Nf3 Nc6 Bb5 e5 O-O d6')).toBeLessThan(lines.indexOf('e4 c5 Nf3 Nc6 Bb5 g6'));
    expect(lines.indexOf('e4 c5 Nf3 Nc6 Bb5 g6')).toBeLessThan(lines.indexOf('e4 c5 c3'));
    expect(lines).not.toContain('d4'); // Weiß-Kapitel nicht dabei
  });

  it('entfernte Äste zählen nicht', () => {
    const cut = study({ cuts: [cutKey(keyAfter(['e4', 'c5']), 'c2c3')] });
    const o = readingOrder(tree, cut, activeChapters(tree, cut));
    expect(o.length).toBe(order.length - 4);
  });

  it('nächste offene Variante: ab der aktuellen Stellung, am Ende von vorn', () => {
    const seen = new Set(order.slice(0, 9).map((x) => x.key)); // Hauptvariante bis 4…d6 angesehen
    const next = nextUnseen(order, seen, order[8].key)!;
    expect(sanPath(next)).toBe('e4 c5 Nf3 Nc6 Bb5 g6');
    const allButFirst = new Set(order.slice(1).map((x) => x.key));
    expect(nextUnseen(order, allButFirst, order[order.length - 1].key)).toEqual([]); // wieder Start
    expect(nextUnseen(order, new Set(order.map((x) => x.key)), tree.root)).toBeUndefined();
  });
});

