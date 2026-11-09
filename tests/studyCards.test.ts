import { describe, it, expect } from 'vitest';
import { buildStudyTree, cutKey, type ExistingEntry } from '../src/core/pgn';
import { activeChapters } from '../src/core/study';
import { buildLinePlan } from '../src/core/studyLines';
import { addLineCards, adoptable, buildRound, cardPath, checkCount, confusable, freshLoad, linePositions, pickCheck, type StudyCards } from '../src/core/studyCards';
import { Scheduler } from '../src/core/srs';
import type { Study } from '../src/core/types';
import { keyAfter } from './helpers';

const PGN = `[Event "K1"]

1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 3. Bb5 *
`;
const tree = buildStudyTree(PGN);
const st: Study = { id: 's', name: 'T', color: 'white', pgn: PGN, choices: {}, cuts: [], skipChapters: [], createdAt: 0, updatedAt: 0 };
const noRep = new Map<string, ExistingEntry>();
const plan = buildLinePlan(tree, st, activeChapters(tree, st), noRep);
const DAY = 86400_000;

describe('Studien-Lernkarten', () => {
  it('eigene Stellungen einer Linie werden Karten, vorhandene bleiben', () => {
    const pos = linePositions(tree, plan.lines[0], 'white'); // 1.e4, 2.Sf3, 3.Lb5
    expect(pos.map((p) => p.uci)).toEqual(['e2e4', 'g1f3', 'f1b5']);
    const c1 = addLineCards({}, pos, 'main', 0);
    expect(Object.keys(c1)).toHaveLength(3);
    expect(addLineCards(c1, pos, 'main', 5)).toBe(c1); // nichts Neues → selbes Objekt
    // schon im Repertoire → keine Karte
    const c2 = addLineCards({}, pos, 'main', 0, (k) => k === tree.root);
    expect(Object.keys(c2)).toHaveLength(2);
  });

  it('Abfrage: erst frisch gelernte in Planreihenfolge, dann fällige; unpassende fallen weg', () => {
    const sch = new Scheduler(0.9);
    let cards: StudyCards = addLineCards({}, linePositions(tree, plan.lines[0], 'white'), 'main', 0);
    // 1.e4 gelernt (fällig nach dem Intervall), Rest neu
    cards = { ...cards, [tree.root]: { ...cards[tree.root], srs: sch.review(cards[tree.root].srs, 3, 0) } };
    const later = 400 * DAY;
    const items = pickCheck(cards, plan, later);
    expect(items.map((i) => [i.uci, i.fresh])).toEqual([
      ['g1f3', true],
      ['f1b5', true],
      ['e2e4', false],
    ]);
    expect(items[1].path).toHaveLength(4); // 1.e4 e5 2.Sf3 Sc6
    expect(checkCount(cards, plan, later)).toBe(3);
    // Zug entfernt → Karte passt nicht mehr zum Plan
    const cutPlan = buildLinePlan(tree, { ...st, cuts: [cutKey(keyAfter(['e4', 'e5', 'Nf3', 'Nc6']), 'f1b5')] }, activeChapters(tree, st), noRep);
    expect(cardPath(cutPlan, keyAfter(['e4', 'e5', 'Nf3', 'Nc6']), 'f1b5')).toBeUndefined();
    expect(pickCheck(cards, cutPlan, later).map((i) => i.uci)).toEqual(['g1f3', 'e2e4']);
    // Höchstzahl
    expect(pickCheck(cards, plan, later, { max: 1 })).toHaveLength(1);
  });

  it('Übernahme: nur Karten mit Historie und gleichem Zug', () => {
    const sch = new Scheduler(0.9);
    const cards: StudyCards = {
      a: { uci: 'e2e4', srs: sch.review(addLineCards({}, [{ key: 'a', uci: 'e2e4' }], 'x', 0).a.srs, 3, 0) },
      b: { uci: 'd2d4', srs: addLineCards({}, [{ key: 'b', uci: 'd2d4' }], 'x', 0).b.srs }, // neu → nichts zu übernehmen
      c: { uci: 'c2c4', srs: sch.review(addLineCards({}, [{ key: 'c', uci: 'c2c4' }], 'x', 0).c.srs, 3, 0) },
    };
    const res = adoptable(cards, [
      { posKey: 'a', uci: 'e2e4' },
      { posKey: 'b', uci: 'd2d4' },
      { posKey: 'c', uci: 'g1f3' }, // anderer Zug übernommen
    ]);
    expect(res.map((r) => r.posKey)).toEqual(['a']);
  });
});

describe('Lernlast und Rundengröße', () => {
  // Zwei Nebenlinien, die lange gleich laufen und spät abweichen (verwechselbar), plus eine frühe Abweichung
  const P2 = `[Event "K"]

1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 (5... b5 6. Bb3 Bc5) 6. Re1 b5 7. Bb3 d6 *
`;
  const t2 = buildStudyTree(P2);
  const s2: Study = { ...st, pgn: P2 };
  const p2 = buildLinePlan(t2, s2, activeChapters(t2, s2), noRep);

  it('verwechselbar: langer gemeinsamer Weg mit später Abweichung, nicht innerhalb derselben Linie', () => {
    const main = [...p2.lines[0].start, ...p2.lines[0].steps];
    const side = p2.lines.find((l) => l.steps[0].uci === 'b7b5')!;
    const sidePath = [...side.start, ...side.steps];
    expect(confusable(main.slice(0, 12), sidePath.slice(0, 11))).toBe(true); // 6.Te1 vs 6.Lb3 nach 5…b5
    expect(confusable(main.slice(0, 4), main.slice(0, 8))).toBe(false); // gleiche Linie
    const early = p2.lines.find((l) => l.steps[0].uci === 'c7c5')!;
    expect(confusable(main.slice(0, 12), [...early.start, ...early.steps])).toBe(false); // früh getrennt
  });

  it('Last zählt verwechselbare Stellungen höher; Runde wächst mit dem Gelernten', () => {
    let cards: StudyCards = {};
    for (const l of p2.lines) cards = addLineCards(cards, linePositions(t2, l, 'white'), l.id, 0);
    const { load, fresh } = freshLoad(cards, p2);
    expect(fresh.length).toBe(Object.keys(cards).length);
    expect(load).toBeGreaterThan(fresh.length); // es gibt verwechselbare Stellungen
    expect(buildRound(cards, p2, 0)).toHaveLength(Math.min(15, fresh.length));
    // nur eine Linie gelernt → kleinere Last, kleinere Runde
    const one = addLineCards({}, linePositions(t2, p2.lines[0], 'white'), 'main', 0);
    expect(freshLoad(one, p2).load).toBeLessThan(load);
    expect(buildRound(one, p2, 0).length).toBeLessThan(buildRound(cards, p2, 0).length);
  });

  it('fällige Wiederholungen im Verhältnis zu den neuen', () => {
    const sch = new Scheduler(0.9);
    let cards: StudyCards = {};
    for (const l of p2.lines) cards = addLineCards(cards, linePositions(t2, l, 'white'), l.id, 0);
    // alle bis auf zwei bewertet (später fällig), zwei bleiben neu
    const keys = Object.keys(cards);
    for (const k of keys.slice(2)) cards[k] = { ...cards[k], srs: sch.review(cards[k].srs, 3, 0) };
    const round = buildRound(cards, p2, 400 * DAY);
    expect(round.filter((i) => i.fresh)).toHaveLength(2);
    expect(round.filter((i) => !i.fresh)).toHaveLength(Math.min(3, keys.length - 2)); // max(3, 2/2)
  });
});
