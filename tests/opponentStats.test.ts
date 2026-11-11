import { describe, it, expect } from 'vitest';
import { buildOppStats, gamesWith, type GameRec } from '../src/core/opponentStats';
import { toGameRec, fetchLichessGames } from '../src/services/lichessGames';
import { keyAfter } from './helpers';

const g = (c: 'w' | 'b', r: 1 | 0 | -1, m: string): GameRec => ({ c, r, m });

describe('Gegner-Statistik aus eigenen Partien', () => {
  const games = [
    g('w', 1, 'e4 e5 Nf3 Nc6 Bb5'),
    g('w', -1, 'e4 e5 Nf3 Nf6 Nxe5'),
    g('w', 0, 'e4 c5 Nf3 d6'),
    g('w', 1, 'e4 e5 Nf3 Nc6 Bc4'),
    g('b', 1, 'd4 d5 c4 e6'), // andere Farbe zählt nicht
  ];

  it('zählt Gegnerantworten pro Stellung (nur Partien dieser Farbe)', () => {
    const s = buildOppStats(games, 'white');
    expect(s.games).toBe(4);
    const afterE4 = s.replies.get(keyAfter(['e4']))!;
    expect(afterE4.map((r) => `${r.san}:${r.n}`)).toEqual(['e5:3', 'c5:1']);
    expect(afterE4[0]).toMatchObject({ uci: 'e7e5', win: 2, draw: 0, loss: 1 });
    const afterNf3 = s.replies.get(keyAfter(['e4', 'e5', 'Nf3']))!;
    expect(afterNf3.map((r) => `${r.san}:${r.n}`)).toEqual(['Nc6:2', 'Nf6:1']);
  });

  it('eigene Züge getrennt von Gegnerzügen', () => {
    const s = buildOppStats(games, 'white');
    expect(s.mine.get(keyAfter(['e4', 'e5', 'Nf3', 'Nc6']))!.map((r) => `${r.san}:${r.n}`)).toEqual(['Bb5:1', 'Bc4:1']);
    expect(s.replies.has(keyAfter(['e4', 'e5', 'Nf3', 'Nc6']))).toBe(false);
  });

  it('Schwarz-Sicht und Zugumstellung (posKey)', () => {
    const s = buildOppStats([g('b', 1, 'd4 d5 c4 e6 Nc3'), g('b', -1, 'c4 e6 d4 d5 Nc3'), g('w', 1, 'e4 e5')], 'black');
    expect(s.games).toBe(2);
    // dieselbe Stellung über zwei Zugfolgen → zusammengezählt
    expect(gamesWith(s, keyAfter(['d4', 'd5', 'c4', 'e6']), 'b1c3')).toBe(2);
    expect(s.replies.get(keyAfter(['d4', 'd5', 'c4', 'e6']))![0]).toMatchObject({ win: 1, loss: 1 });
    expect(gamesWith(undefined, 'x', 'y')).toBe(0);
  });

  it('unlesbare Züge beenden nur die betroffene Partie', () => {
    const s = buildOppStats([g('w', 1, 'e4 e5 Qxx9 Nc6'), g('w', 1, 'e4 e5')], 'white');
    expect(s.replies.get(keyAfter(['e4']))![0].n).toBe(2);
  });
});

describe('Lichess-Partien laden', () => {
  const api = (over: object) => ({
    moves: 'e4 e5 Nf3',
    winner: 'white',
    variant: 'standard',
    createdAt: 5,
    players: { white: { user: { id: 'dom' } }, black: { user: { id: 'gegner' } } },
    ...over,
  });

  it('Datensatz aus meiner Sicht', () => {
    expect(toGameRec(api({}), 'dom')).toMatchObject({ c: 'w', r: 1, m: 'e4 e5 Nf3', t: 5, src: 'lichess' });
    expect(toGameRec(api({}), 'gegner')).toMatchObject({ c: 'b', r: -1, m: 'e4 e5 Nf3', t: 5 });
    expect(toGameRec(api({ winner: undefined }), 'dom')!.r).toBe(0);
    expect(toGameRec(api({ variant: 'chess960' }), 'dom')).toBeUndefined();
    expect(toGameRec(api({ initialFen: 'x' }), 'dom')).toBeUndefined();
    expect(toGameRec(api({}), 'jemand')).toBeUndefined();
  });

  it('liest NDJSON, überspringt Fremdes, meldet Fehler verständlich', async () => {
    const body = [JSON.stringify(api({})), 'kaputt', JSON.stringify(api({ variant: 'crazyhouse' })), JSON.stringify(api({ moves: 'd4 d5' }))].join('\n');
    let seen: { url: string; auth?: string } | undefined;
    const ok = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).Authorization };
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchLichessGames('Dom', { max: 50, token: 'lip_x', fetchImpl: ok });
    expect(out.map((x) => x.m)).toEqual(['e4 e5 Nf3', 'd4 d5']);
    expect(seen!.url).toContain('/api/games/user/Dom?max=50');
    expect(seen!.auth).toBe('Bearer lip_x');
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchLichessGames('Nix', { max: 5, fetchImpl: notFound })).rejects.toThrow(/kennt den Namen/);
    const limit = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await expect(fetchLichessGames('Dom', { max: 5, fetchImpl: limit })).rejects.toThrow(/Limit/);
    await expect(fetchLichessGames('  ', { max: 5 })).rejects.toThrow(/Namen/);
  });
});
