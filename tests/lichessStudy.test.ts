import { describe, it, expect } from 'vitest';
import { parseStudyUrl, studyName, studyPgnUrl } from '../src/services/lichessStudy';

describe('Lichess-Studienlink', () => {
  it('erkennt Studie, Kapitel und API-Link, aber keine Wörter', () => {
    expect(parseStudyUrl('https://lichess.org/study/9ogFv8Ac')).toEqual({ study: '9ogFv8Ac', chapter: undefined });
    expect(parseStudyUrl('lichess.org/study/9ogFv8Ac/HnF3HVdu#12')).toEqual({ study: '9ogFv8Ac', chapter: 'HnF3HVdu' });
    expect(parseStudyUrl('https://lichess.org/api/study/9ogFv8Ac.pgn')).toEqual({ study: '9ogFv8Ac', chapter: undefined });
    expect(parseStudyUrl('https://lichess.org/abcdefgh')).toBeUndefined();
    expect(parseStudyUrl('Spanisch')).toBeUndefined();
  });
  it('baut die API-URL und liest den Studiennamen', () => {
    expect(studyPgnUrl({ study: 'AAAAAAAA' })).toBe('https://lichess.org/api/study/AAAAAAAA.pgn');
    expect(studyPgnUrl({ study: 'AAAAAAAA', chapter: 'BBBBBBBB' })).toBe('https://lichess.org/api/study/AAAAAAAA/BBBBBBBB.pgn');
    expect(studyName('[Event "X: Kap 1"]\n[StudyName "Mein Spanisch"]\n\n1. e4 *')).toBe('Mein Spanisch');
  });
});
