import { describe, it, expect } from 'vitest';
import { fetchChesscomGames, pgnMoves, toGameRecCc } from '../src/services/chesscomGames';

const pgn = (moves: string, extra = '') => `[Event "Live Chess"]\n[White "Dom"]\n[Black "Gegner"]\n${extra}\n${moves} 1-0`;
const game = (over: object = {}) => ({
  url: 'https://www.chess.com/game/live/123',
  pgn: pgn('1. e4 {[%clk 0:09:58]} e5 2. Nf3 Nc6 3. Bb5'),
  rules: 'chess',
  end_time: 1700000000,
  white: { username: 'Dom', result: 'win' },
  black: { username: 'Gegner', result: 'resigned' },
  ...over,
});

describe('Chess.com-Partien laden', () => {
  it('Züge aus dem PGN ohne Kommentare', () => {
    expect(pgnMoves(game().pgn)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(pgnMoves('')).toBeUndefined();
  });

  it('Datensatz aus meiner Sicht (Name unabhängig von Groß-/Kleinschreibung), Varianten werden übersprungen', () => {
    expect(toGameRecCc(game(), 'dom')).toMatchObject({ c: 'w', r: 1, m: 'e4 e5 Nf3 Nc6 Bb5', src: 'chesscom', id: '123', opp: 'Gegner', t: 1700000000000 });
    expect(toGameRecCc(game(), 'gegner')).toMatchObject({ c: 'b', r: -1 });
    expect(toGameRecCc(game({ white: { username: 'Dom', result: 'agreed' }, black: { username: 'Gegner', result: 'agreed' } }), 'dom')!.r).toBe(0);
    expect(toGameRecCc(game({ rules: 'chess960' }), 'dom')).toBeUndefined();
    expect(toGameRecCc(game({ pgn: pgn('1. e4 e5', '[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/K1k5 w - - 0 1"]') }), 'dom')).toBeUndefined();
    expect(toGameRecCc(game(), 'jemand')).toBeUndefined();
  });

  it('lädt Monatsarchive neueste zuerst bis max, Fehler verständlich', async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      if (url.endsWith('/archives')) return new Response(JSON.stringify({ archives: ['https://x/2026/09', 'https://x/2026/10', 'https://x/2026/11'] }));
      return new Response(JSON.stringify({ games: [game({ url: `${url}/a` }), game({ url: `${url}/b` })] }));
    }) as unknown as typeof fetch;
    const out = await fetchChesscomGames('Dom', { max: 3, fetchImpl: f });
    expect(out).toHaveLength(3);
    expect(calls.slice(1)).toEqual(['https://x/2026/11', 'https://x/2026/10']); // September wird nicht mehr gebraucht
    const nf = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchChesscomGames('Nix', { max: 5, fetchImpl: nf })).rejects.toThrow(/kennt den Namen/);
    await expect(fetchChesscomGames(' ', { max: 5 })).rejects.toThrow(/Namen/);
  });
});
