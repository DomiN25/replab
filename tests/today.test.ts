import { describe, it, expect } from 'vitest';
import { buildStudyTree, cutKey, type ExistingEntry } from '../src/core/pgn';
import { activeChapters } from '../src/core/study';
import { buildLinePlan } from '../src/core/studyLines';
import { addLineCards, linePositions, type StudyCards } from '../src/core/studyCards';
import { newSrs, Scheduler } from '../src/core/srs';
import { dueByRepertoire, studyDue } from '../src/core/today';
import type { Card, Study } from '../src/core/types';

const DAY = 86400_000;
const sch = new Scheduler(0.9);
const learned = (at: number) => sch.review(newSrs(at), 3, at);

describe('Heute über alle Repertoires', () => {
  const card = (id: string, repertoireId: string, srs = newSrs(0), suspended = false): Card => ({
    id,
    repertoireId,
    posKey: id,
    uci: 'e2e4',
    srs,
    suspended,
    createdAt: 0,
    updatedAt: 0,
  });

  it('zählt fällige und neue Karten je Repertoire, pausierte nicht', () => {
    const later = 400 * DAY;
    const m = dueByRepertoire(
      [card('a', 'w'), card('b', 'w', learned(0)), card('c', 'b', learned(0)), card('d', 'b', learned(0), true), card('e', 'b', learned(later))],
      later,
    );
    expect(m.get('w')).toEqual({ due: 1, fresh: 1 });
    expect(m.get('b')).toEqual({ due: 1, fresh: 0 }); // d pausiert, e gerade erst gelernt
  });
});

describe('Heute: fällige Studienkarten', () => {
  const PGN = `[Event "K1"]

1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 3. Bb5 *
`;
  const tree = buildStudyTree(PGN);
  const base: Study = { id: 's', name: 'T', color: 'white', pgn: PGN, choices: {}, cuts: [], skipChapters: [], createdAt: 0, updatedAt: 0 };
  const noRep = new Map<string, ExistingEntry>();
  const plan = buildLinePlan(tree, base, activeChapters(tree, base), noRep);
  const fresh: StudyCards = addLineCards({}, linePositions(tree, plan.lines[0], 'white'), 'main', 0); // 1.e4, 2.Sf3, 3.Lb5

  it('ohne Karten oder ohne Fälliges: 0 (ohne den Baum zu bauen)', () => {
    expect(studyDue(base, noRep, 0)).toEqual({ due: 0, fresh: 0 });
    const allLearned: StudyCards = Object.fromEntries(Object.entries(fresh).map(([k, c]) => [k, { ...c, srs: learned(0) }]));
    expect(studyDue({ ...base, cards: allLearned, pgn: 'kaputt' }, noRep, 1000)).toEqual({ due: 0, fresh: 0 });
  });

  it('trennt neu gelernte von fälligen Karten', () => {
    const cards: StudyCards = { ...fresh, [tree.root]: { ...fresh[tree.root], srs: learned(0) } };
    expect(studyDue({ ...base, cards }, noRep, 400 * DAY)).toEqual({ due: 1, fresh: 2 });
  });

  it('zählt wie die Studie: Stellungen im Repertoire und entfernte Züge fallen weg', () => {
    const cards: StudyCards = Object.fromEntries(Object.entries(fresh).map(([k, c]) => [k, { ...c, srs: learned(0) }]));
    const later = 400 * DAY;
    expect(studyDue({ ...base, cards }, noRep, later).due).toBe(3);
    // 1.e4 steht schon so im Repertoire → übt das normale Training
    const rep = new Map<string, ExistingEntry>([[tree.root, { uci: 'e2e4', san: 'e4' }]]);
    expect(studyDue({ ...base, cards }, rep, later).due).toBe(2);
    // 3.Lb5 aus der Studie entfernt → Karte passt nicht mehr zum Plan
    const lb5 = plan.lines[0].steps.find((s) => s.uci === 'f1b5')!;
    expect(studyDue({ ...base, cards, cuts: [cutKey(lb5.key, lb5.uci)] }, noRep, later).due).toBe(2);
  });
});
