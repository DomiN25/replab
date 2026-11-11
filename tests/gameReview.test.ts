import { describe, it, expect } from 'vitest';
import { findMistake, reviewGame, type RepView } from '../src/core/gameReview';
import type { GameRec } from '../src/core/opponentStats';
import { keyAfter } from './helpers';

// Repertoire als Weiß: 1.e4, nach 1…e5 2.Nf3, nach 2…Nc6 3.Bb5; bekannt: e5, Nc6, Nf6 (Gegnerzüge); Ende-Marker nach 3…a6
const mine: Record<string, { uci: string; san: string }> = {
  [keyAfter([])]: { uci: 'e2e4', san: 'e4' },
  [keyAfter(['e4', 'e5'])]: { uci: 'g1f3', san: 'Nf3' },
  [keyAfter(['e4', 'e5', 'Nf3', 'Nc6'])]: { uci: 'f1b5', san: 'Bb5' },
};
const known = new Set([keyAfter([]), keyAfter(['e4']), keyAfter(['e4', 'e5']), keyAfter(['e4', 'e5', 'Nf3']), keyAfter(['e4', 'e5', 'Nf3', 'Nc6']), keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])]);
const end = new Set([keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])]);
const rep: RepView = { myMove: (k) => mine[k], known: (k) => known.has(k), isEnd: (k) => end.has(k) };
const g = (m: string, extra: Partial<GameRec> = {}): GameRec => ({ c: 'w', r: 1, m, ...extra });

describe('Partien gegen das Repertoire prüfen', () => {
  it('Abweichung von meinem Repertoirezug', () => {
    const r = reviewGame(g('e4 e5 Bc4 Nc6'), 'white', rep);
    expect(r.status).toBe('my-deviation');
    expect(r.ply).toBe(2);
    expect(r.rep).toEqual({ uci: 'g1f3', san: 'Nf3' });
    expect(r.played).toEqual({ uci: 'f1c4', san: 'Bc4' });
    expect(r.prefix).toEqual(['e2e4', 'e7e5']);
    expect(r.inRepPlies).toBe(2);
  });

  it('Gegner spielt etwas, das nicht vorbereitet ist', () => {
    const r = reviewGame(g('e4 d5 exd5'), 'white', rep);
    expect(r.status).toBe('opp-new');
    expect(r.ply).toBe(1);
    expect(r.played!.san).toBe('d5');
    expect(r.prefix).toEqual(['e2e4']); // vor dem Gegnerzug
  });

  it('Stellung ohne eigenen Zug (Lücke) und Ende-Marker', () => {
    const hole = reviewGame(g('e4 e5 Nf3 Nf6 Nxe5'), 'white', { ...rep, known: () => true });
    expect(hole.status).toBe('hole');
    expect(hole.ply).toBe(4);
    const e = reviewGame(g('e4 e5 Nf3 Nc6 Bb5 a6 Ba4'), 'white', rep);
    expect(e.status).toBe('end');
    expect(e.ply).toBe(6);
  });

  it('ganz im Repertoire, und Schwarz-Sicht', () => {
    expect(reviewGame(g('e4 e5 Nf3 Nc6 Bb5'), 'white', rep)).toMatchObject({ status: 'in-rep', inRepPlies: 5 });
    // als Schwarz: eigener Zug e5 nach 1.e4 – kein Repertoirezug bekannt → Lücke
    const b = reviewGame({ c: 'b', r: -1, m: 'e4 e5' }, 'black', { myMove: () => undefined, known: () => true, isEnd: () => false });
    expect(b).toMatchObject({ status: 'hole', ply: 1 });
  });

  it('Fehler aus Lichess-Bewertungen: erster eigener Zug mit Verlust ≥ 1,5', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5'];
    // ev nach jedem Halbzug (Weiß-Sicht): Weiß verliert nach Zug 7 (Index 6) 2,0 Bauern
    const ev = [20, 25, 30, 28, 35, 30, -170, -180];
    expect(findMistake(ev, sans, 'white')).toEqual({ ply: 6, san: 'Nxe5', drop: 200 });
    // als Schwarz zählt der Verlust aus Schwarz-Sicht: Index 7 (…Dg5) von −170 auf +300
    expect(findMistake([20, 25, 30, 28, 35, 30, -170, 300], sans, 'black')).toEqual({ ply: 7, san: 'Qg5', drop: 470 });
    expect(findMistake(undefined, sans, 'white')).toBeUndefined();
    expect(findMistake([20, 20], ['e4', 'e5'], 'white')).toBeUndefined();
    const r = reviewGame(g('e4 e5 Nf3 Nc6 Bb5', { ev: [20, 20, 20, 20, -400] }), 'white', rep);
    expect(r.mistake).toMatchObject({ ply: 4, san: 'Bb5' });
  });
});
