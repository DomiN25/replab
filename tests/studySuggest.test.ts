import { describe, it, expect, beforeEach } from 'vitest';
import { clearStudyIndex, indexStudy, suggestionsFor } from '../src/ui/studySuggest';
import { cutKey } from '../src/core/pgn';
import type { Study } from '../src/core/types';
import { keyAfter } from './helpers';

const PGN = `[Event "K1"]\n[ChapterName "Najdorf"]\n\n1. e4 c5 2. Nf3 d6 (2... e6 3. d4) 3. d4 *\n\n[Event "K2"]\n[ChapterName "Sveshnikov"]\n\n1. e4 c5 2. Nf3 Nc6 *\n`;
const study = (over: Partial<Study> = {}): Study => ({
  id: 's1',
  name: 'Sizilianisch',
  color: 'black',
  pgn: PGN,
  choices: {},
  cuts: [],
  skipChapters: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('Studien-Vorschläge im Repertoire', () => {
  beforeEach(() => clearStudyIndex());

  it('liefert die Züge der Studie in der Stellung (nur passende Farbe)', () => {
    indexStudy(study());
    const s = suggestionsFor(keyAfter(['e4', 'c5', 'Nf3']), 'black');
    expect(s).toHaveLength(1);
    expect(s[0].studyName).toBe('Sizilianisch');
    expect(s[0].moves.map((m) => m.san).sort()).toEqual(['Nc6', 'd6', 'e6']);
    expect(suggestionsFor(keyAfter(['e4', 'c5', 'Nf3']), 'white')).toEqual([]);
    expect(suggestionsFor(keyAfter(['d4']), 'black')).toEqual([]);
  });

  it('abgewählte Kapitel und entfernte Züge fallen weg', () => {
    const key = keyAfter(['e4', 'c5', 'Nf3']);
    indexStudy(study({ skipChapters: [1], cuts: [cutKey(key, 'e7e6')] }));
    expect(suggestionsFor(key, 'black')[0].moves.map((m) => m.san)).toEqual(['d6']);
  });

  it('defektes PGN bricht nichts', () => {
    expect(() => indexStudy(study({ pgn: 'kein pgn' }))).not.toThrow();
  });
});
