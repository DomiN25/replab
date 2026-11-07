import { describe, it, expect } from 'vitest';
import { parseInfo, parseBestMove } from '../src/core/uci';

describe('UCI-Parser', () => {
  it('liest Tiefe, MultiPV, Bewertung und PV', () => {
    const i = parseInfo(
      'info depth 18 seldepth 26 multipv 3 score cp 26 nodes 662188 nps 705957 hashfull 234 time 938 pv d2d4 g8f6 g1f3',
    )!;
    expect(i).toMatchObject({ depth: 18, seldepth: 26, multipv: 3, cp: 26, nodes: 662188, time: 938 });
    expect(i.pv).toEqual(['d2d4', 'g8f6', 'g1f3']);
  });

  it('Matt und Schranken', () => {
    const i = parseInfo('info depth 12 multipv 1 score mate -3 upperbound nodes 10 pv e1e2')!;
    expect(i.mate).toBe(-3);
    expect(i.cp).toBeUndefined();
    expect(i.bound).toBe('upper');
  });

  it('ignoriert Zeilen ohne pv', () => {
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeUndefined();
    expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1')).toBeUndefined();
  });

  it('bestmove', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseBestMove('bestmove (none)')).toBeUndefined();
  });
});
