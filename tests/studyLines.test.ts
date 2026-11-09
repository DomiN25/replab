import { describe, it, expect } from 'vitest';
import { buildStudyTree, cutKey, type ExistingEntry } from '../src/core/pgn';
import { activeChapters, readingOrder, skipNotChosen } from '../src/core/study';
import { buildLinePlan, lineAt, lineForMove, nextOpenLine } from '../src/core/studyLines';
import type { Study } from '../src/core/types';
import { keyAfter } from './helpers';

const noRep = new Map<string, ExistingEntry>();
const mk = (pgn: string, p: Partial<Study> = {}): Study => ({
  id: 's', name: 'T', color: 'white', pgn, choices: {}, cuts: [], skipChapters: [], createdAt: 0, updatedAt: 0, ...p,
});
const sans = (tree: ReturnType<typeof buildStudyTree>, l: { steps: { key: string; uci: string }[] }) =>
  l.steps.map((s) => tree.nodes.get(s.key)!.moves.find((m) => m.uci === s.uci)!.san).join(' ');

// Weiß-Studie: Hauptvariante mit zwei Nebenlinien (1…c5, 2…d6), 1…c5 hat selbst eine Untervariante (2…Sc6)
const NESTED = `[Event "K1"]

1. e4 e5 (1... c5 2. Nf3 d6 (2... Nc6 3. Bb5) 3. d4) 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *
`;

describe('Studie in Linien zerlegen', () => {
  const tree = buildStudyTree(NESTED);
  const st = mk(NESTED);
  const active = activeChapters(tree, st);

  it('„Gerüst zuerst“: Hauptlinie, dann Nebenlinien, dann Untervarianten', () => {
    const plan = buildLinePlan(tree, st, active, noRep, 'skeleton');
    expect(plan.lines.map((l) => sans(tree, l))).toEqual(['e4 e5 Nf3 Nc6 Bb5', 'c5 Nf3 d6 d4', 'd6 d4', 'Nc6 Bb5']);
    expect(plan.lines.map((l) => l.level)).toEqual([0, 1, 1, 2]);
    expect(plan.perLevel).toEqual([1, 2, 1]);
    // Untervariante hängt an der 1…c5-Linie, Abzweig nach 1.e4 c5 2.Sf3
    expect(plan.lines[3].parent).toBe(1);
    expect(plan.lines[3].start).toHaveLength(3);
  });

  it('„Wie in der Studie“: Tiefensuche – Untervariante direkt nach ihrer Nebenlinie', () => {
    const plan = buildLinePlan(tree, st, active, noRep, 'study');
    expect(plan.lines.map((l) => sans(tree, l))).toEqual(['e4 e5 Nf3 Nc6 Bb5', 'c5 Nf3 d6 d4', 'Nc6 Bb5', 'd6 d4']);
  });

  it('jede Stellung gehört genau einer Linie; Sprünge über Züge', () => {
    const plan = buildLinePlan(tree, st, active, noRep);
    const afterE4 = keyAfter(['e4']);
    expect(lineAt(plan, tree.root)).toEqual({ line: 0, step: 0 });
    expect(lineAt(plan, afterE4)).toEqual({ line: 0, step: 1 });
    expect(lineForMove(plan, afterE4, 'e7e5')).toEqual({ line: 0, step: 2 }); // Fortsetzung
    expect(lineForMove(plan, afterE4, 'c7c5')).toEqual({ line: 1, step: 1 }); // Abzweig
    expect(lineForMove(plan, afterE4, 'a7a6')).toBeUndefined();
  });

  it('entfernter Ast fällt samt Untervarianten weg', () => {
    const plan = buildLinePlan(tree, mk(NESTED, { cuts: [cutKey(keyAfter(['e4']), 'c7c5')] }), active, noRep);
    expect(plan.lines.map((l) => sans(tree, l))).toEqual(['e4 e5 Nf3 Nc6 Bb5', 'd6 d4']);
  });

  it('nächste offene Linie, am Ende wieder von vorn', () => {
    const plan = buildLinePlan(tree, st, active, noRep);
    const ids = plan.lines.map((l) => l.id);
    expect(nextOpenLine(plan, new Set([ids[1]]), 0)).toBe(2);
    expect(nextOpenLine(plan, new Set([ids[0], ids[2], ids[3]]), 3)).toBe(1);
    expect(nextOpenLine(plan, new Set(ids), 0)).toBeUndefined();
  });
});

describe('Zugumstellungen und eigene Züge', () => {
  // Kapitel 2 erreicht über 1.Sf3 Sc6 2.e4 e5 dieselbe Stellung wie Kapitel 1 nach 2…Sc6 und spielt dort 3.Lb5
  const TRANS = `[Event "K1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "K2"]

1. Nf3 Nc6 2. e4 e5 3. Bb5 *
`;
  it('Kapitel-Hauptvarianten sind Ebene 0; Linie endet an bekannter Stellung', () => {
    const tree = buildStudyTree(TRANS);
    // Wahl 1.e4 (eigener Zug) – 1.Sf3 ist dann ein nicht gewählter eigener Zug und keine Linie
    const st = mk(TRANS);
    const plan = buildLinePlan(tree, st, activeChapters(tree, st), noRep);
    expect(plan.lines.map((l) => sans(tree, l))).toEqual(['e4 e5 Nf3 Nc6 Bc4']);
    // Schwarz-Sicht: alle weißen Züge sind Gegnerzüge → beide Kapitel als Linien
    const stB = mk(TRANS, { color: 'black' });
    const planB = buildLinePlan(tree, stB, activeChapters(tree, stB), noRep);
    expect(planB.lines.map((l) => sans(tree, l))).toEqual(['e4 e5 Nf3 Nc6 Bc4', 'Nf3 Nc6 e4 e5', 'Bb5']);
    expect(planB.lines.map((l) => l.level)).toEqual([0, 0, 0]);
    expect(planB.lines[1].transposeTo).toMatchObject({ line: 0, step: 4 });
  });

  it('gewählter eigener Zug bestimmt die Linie, vorhandener Repertoirezug ebenso', () => {
    const PGN = `[Event "K"]

1. e4 (1. d4 d5) e5 *
`;
    const tree = buildStudyTree(PGN);
    const chosen = mk(PGN, { choices: { [tree.root]: 'd2d4' } });
    expect(buildLinePlan(tree, chosen, activeChapters(tree, chosen), noRep).lines.map((l) => sans(tree, l))).toEqual(['d4 d5']);
    const rep = new Map<string, ExistingEntry>([[tree.root, { uci: 'd2d4', san: 'd4' }]]);
    const st = mk(PGN);
    expect(buildLinePlan(tree, st, activeChapters(tree, st), rep).lines.map((l) => sans(tree, l))).toEqual(['d4 d5']);
  });
});

describe('Leistung', () => {
  it('große Studie (~7000 Stellungen) in kurzer Zeit zerlegt', async () => {
    const { Chess } = await import('chessops/chess');
    const { makeSan } = await import('chessops/san');
    // Zufällige, aber reproduzierbare Partien mit gemeinsamem Anfang → großer verzweigter Baum
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const games: string[] = [];
    for (let g = 0; g < 1400; g++) {
      const pos = Chess.default();
      const sanList: string[] = [];
      for (let ply = 0; ply < 24 && !pos.isEnd(); ply++) {
        const moves: { from: number; to: number }[] = [];
        for (const [from, dests] of pos.allDests()) for (const to of dests) moves.push({ from, to });
        // früh wenig Streuung (gemeinsame Hauptlinien), später mehr
        // Schwarz (Repertoire-Seite) spielt pro Stellung immer denselben Zug, Weiß streut – wie ein echtes Repertoire
        const pick = ply % 2 === 1 ? 0 : ply < 6 ? Math.floor(rnd() * Math.min(2, moves.length)) : Math.floor(rnd() * moves.length);
        const mv = moves[pick];
        sanList.push(makeSan(pos, mv));
        pos.play(mv);
      }
      games.push(`[Event "K${g}"]\n\n${sanList.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *\n`);
    }
    const pgn = games.join('\n');
    const tree = buildStudyTree(pgn);
    expect(tree.nodes.size).toBeGreaterThan(6000);
    const st = mk(pgn, { color: 'black' });
    const active = activeChapters(tree, st);
    const t0 = performance.now();
    const plan = buildLinePlan(tree, st, active, noRep);
    const ms = performance.now() - t0;
    // jede Stellung, die gelernt wird (nur gewählte eigene Züge), gehört genau einer Linie
    expect(plan.owner.size).toBe(readingOrder(tree, st, active, { skip: skipNotChosen(tree, st, active, noRep) }).length);
    expect(plan.lines.length).toBeGreaterThan(100);
    console.info(`Linienplan: ${tree.nodes.size} Stellungen, ${plan.lines.length} Linien, ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(400);
  });
});
