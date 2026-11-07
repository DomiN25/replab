import { describe, it, expect } from 'vitest';
import {
  START_FEN,
  posKeyOf,
  playUci,
  playSan,
  sanToDe,
  formatLine,
  isLegalUci,
  turnOf,
  uciLineToSan,
  moveFromUci,
  positionFromFen,
} from '../src/core/chess';

function playLine(sans: string[], fen = START_FEN) {
  let f = fen;
  for (const s of sans) {
    const r = playSan(f, s);
    if (!r) throw new Error('illegal ' + s);
    f = r.fen;
  }
  return f;
}

describe('posKey', () => {
  it('lässt Zugzähler weg', () => {
    expect(posKeyOf(START_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });

  it('entfernt ein nicht schlagbares en-passant-Feld (1.e4)', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(posKeyOf(fen)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
  });

  it('behält das en-passant-Feld, wenn der Schlag legal ist', () => {
    const fen = playLine(['e4', 'd5', 'e5', 'f5']);
    expect(posKeyOf(fen)).toBe('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6');
  });

  it('entfernt ep, wenn der Schlag wegen Fesselung illegal wäre', () => {
    // Weißer König a5, weißer Bauer b5, schwarzer Turm h5: nach c7-c5 wäre bxc6 illegal (Fesselung auf Reihe 5)
    const fen = '4k3/2p5/8/KP5r/8/8/8/8 b - - 0 1';
    const after = playUci(fen, 'c7c5');
    expect(after.posKey.endsWith(' -')).toBe(true);
  });

  it('Zugumstellungen ergeben denselben posKey', () => {
    const a = playLine(['e4', 'c5', 'Nf3', 'd6', 'd4']);
    const b = playLine(['Nf3', 'c5', 'e4', 'd6', 'd4']);
    expect(posKeyOf(a)).toBe(posKeyOf(b));
  });

  it('unterscheidet Rochaderechte', () => {
    const a = playLine(['e4', 'e5', 'Ke2', 'Ke7', 'Ke1', 'Ke8']);
    expect(posKeyOf(a)).not.toBe(posKeyOf(START_FEN));
    expect(posKeyOf(a).split(' ')[2]).toBe('-');
  });
});

describe('Züge', () => {
  it('playUci liefert SAN, Standard-UCI und Folge-FEN', () => {
    const r = playUci(START_FEN, 'g1f3');
    expect(r.san).toBe('Nf3');
    expect(r.uci).toBe('g1f3');
    expect(turnOf(r.fen)).toBe('black');
  });

  it('Rochade: e1g1 und e1h1 werden beide akzeptiert, gespeichert wird e1g1', () => {
    const fen = playLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const a = playUci(fen, 'e1g1');
    const b = playUci(fen, 'e1h1');
    expect(a.san).toBe('O-O');
    expect(a.uci).toBe('e1g1');
    expect(b.uci).toBe('e1g1');
    expect(a.posKey).toBe(b.posKey);
    expect(playSan(fen, 'O-O')!.uci).toBe('e1g1');
  });

  it('lange Rochade Schwarz → e8c8', () => {
    const fen = 'r3kbnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/R3KBNR b KQkq - 5 5';
    expect(playSan(fen, 'O-O-O')!.uci).toBe('e8c8');
  });

  it('erkennt illegale Züge', () => {
    expect(isLegalUci(START_FEN, 'e2e5')).toBe(false);
    expect(isLegalUci(START_FEN, 'e2e4')).toBe(true);
    expect(() => playUci(START_FEN, 'e2e5')).toThrow();
    expect(playSan(START_FEN, 'Nf6')).toBeUndefined();
  });

  it('Umwandlung', () => {
    const fen = '8/P7/8/8/8/8/8/k6K w - - 0 1';
    const r = playUci(fen, 'a7a8q');
    expect(r.san).toBe('a8=Q+');
    expect(sanToDe(r.san)).toBe('a8=D+');
  });

  it('uciLineToSan bricht bei illegalem Zug ab', () => {
    expect(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'e1e3', 'g1f3'])).toEqual(['e4', 'e5']);
  });

  it('moveFromUci normalisiert Rochade', () => {
    const fen = playLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const m = moveFromUci(positionFromFen(fen), 'e1g1');
    expect(m).toBeDefined();
  });
});

describe('Notation', () => {
  it('deutsche Figurenbuchstaben', () => {
    expect(sanToDe('Nf3')).toBe('Sf3');
    expect(sanToDe('Bxc6')).toBe('Lxc6');
    expect(sanToDe('Rfe1')).toBe('Tfe1');
    expect(sanToDe('Qxd8+')).toBe('Dxd8+');
    expect(sanToDe('Kh1')).toBe('Kh1');
    expect(sanToDe('O-O')).toBe('O-O');
    expect(sanToDe('exd5')).toBe('exd5');
  });

  it('formatLine mit Zugnummern', () => {
    expect(formatLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])).toBe('1.e4 e5 2.Sf3 Sc6 3.Lb5');
    expect(formatLine(['Nc6', 'Bb5'], 'de', 3)).toBe('2…Sc6 3.Lb5');
    expect(formatLine(['Nf3'], 'en')).toBe('1.Nf3');
  });
});
