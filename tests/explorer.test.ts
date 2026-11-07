// Integration: Explorer-Service mit gemocktem fetch (Pflichtenheft 9: Queue, 429-Backoff, Cache).
import { describe, it, expect, vi } from 'vitest';
import { ExplorerService, ExplorerAuthError, BACKOFF_MS, explorerSig, type ExplorerParams } from '../src/services/explorer';
import { START_FEN } from '../src/core/chess';
import { fenAfter } from './helpers';
import type { ExplorerData } from '../src/core/types';

const P: ExplorerParams = { source: 'lichess', speeds: ['rapid', 'classical'], ratings: [1800, 2000] };

function body(moves: [string, string, number][]) {
  return {
    white: moves.reduce((s, m) => s + m[2], 0),
    draws: 0,
    black: 0,
    moves: moves.map(([uci, san, n]) => ({ uci, san, white: n, draws: 0, black: 0 })),
    opening: { eco: 'B00', name: "King's Pawn" },
  };
}

function memCache() {
  const m = new Map<string, ExplorerData>();
  return { m, get: async (k: string) => m.get(k), put: async (d: ExplorerData) => void m.set(d.key, d) };
}

function jsonResponse(status: number, data?: unknown): Response {
  return new Response(data ? JSON.stringify(data) : 'x', { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ExplorerService', () => {
  it('immer nur eine Anfrage gleichzeitig', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return jsonResponse(200, body([['e7e5', 'e5', 10]]));
    });
    const s = new ExplorerService({ cache: memCache(), getToken: () => 'lip_x', fetch: fetchMock as unknown as typeof fetch });
    const fens = [START_FEN, fenAfter(['e4']), fenAfter(['d4']), fenAfter(['c4'])];
    await Promise.all(fens.map((f) => s.get(f, P)));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(1);
  });

  it('sendet den Token als Bearer-Header', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer lip_abc');
      return jsonResponse(200, body([]));
    });
    const s = new ExplorerService({ cache: memCache(), getToken: () => 'lip_abc', fetch: fetchMock as unknown as typeof fetch });
    await s.get(START_FEN, P);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('Cache-Treffer ohne Netz; nach 30 Tagen neu laden', async () => {
    const cache = memCache();
    let now = 1_000_000;
    const fetchMock = vi.fn(async () => jsonResponse(200, body([['e2e4', 'e4', 100]])));
    const s = new ExplorerService({ cache, getToken: () => 't', fetch: fetchMock as unknown as typeof fetch, now: () => now });
    const a = await s.get(START_FEN, P);
    const b = await s.get(START_FEN, P);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(a.sig).toBe(explorerSig(P));
    expect(a.total).toBe(100);
    now += 31 * 86400_000;
    await s.get(START_FEN, P);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gleichzeitige Anfragen derselben Stellung werden zusammengefasst', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, body([])));
    const s = new ExplorerService({ cache: memCache(), getToken: () => 't', fetch: fetchMock as unknown as typeof fetch });
    await Promise.all([s.get(START_FEN, P), s.get(START_FEN, P), s.get(START_FEN, P)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 → mindestens 60 s Pause, dann erneuter Versuch', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchMock = vi.fn(async () => (++calls === 1 ? jsonResponse(429) : jsonResponse(200, body([['e7e5', 'e5', 3]]))));
    const s = new ExplorerService({
      cache: memCache(),
      getToken: () => 't',
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const states: string[] = [];
    s.subscribe((st) => states.push(st.state));
    const d = await s.get(fenAfter(['e4']), P);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(BACKOFF_MS);
    expect(states).toContain('backoff');
    expect(d.moves[0].san).toBe('e5');
  });

  it('HTTP 401 → Token-Fehler, wartende Anfragen werden abgelehnt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401));
    const s = new ExplorerService({ cache: memCache(), getToken: () => undefined, fetch: fetchMock as unknown as typeof fetch });
    const r = await Promise.allSettled([s.get(START_FEN, P), s.get(fenAfter(['e4']), P)]);
    expect(r.every((x) => x.status === 'rejected' && x.reason instanceof ExplorerAuthError)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.status.state).toBe('auth');
    // ohne Token sofortige Ablehnung ohne Netz
    await expect(s.get(fenAfter(['d4']), P)).rejects.toBeInstanceOf(ExplorerAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('höhere Priorität wird zuerst abgearbeitet', async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async (u: string) => {
      order.push(decodeURIComponent(u.split('fen=')[1].split('&')[0]).split(' ')[0]);
      await new Promise((r) => setTimeout(r, 2));
      return jsonResponse(200, body([]));
    });
    const s = new ExplorerService({ cache: memCache(), getToken: () => 't', fetch: fetchMock as unknown as typeof fetch });
    const low = [fenAfter(['a3']), fenAfter(['b3']), fenAfter(['c3'])].map((f) => s.get(f, P, { priority: 0 }));
    const high = s.get(fenAfter(['h3']), P, { priority: 10 });
    await Promise.all([...low, high]);
    // erste Anfrage lief schon, danach kommt die hohe Priorität
    expect(order[1]).toBe(fenAfter(['h3']).split(' ')[0]);
  });

  it('Rochade aus dem Explorer wird auf e1g1 normalisiert', async () => {
    const fen = fenAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const fetchMock = vi.fn(async () => jsonResponse(200, body([['e1h1', 'O-O', 50]])));
    const s = new ExplorerService({ cache: memCache(), getToken: () => 't', fetch: fetchMock as unknown as typeof fetch });
    const d = await s.get(fen, P);
    expect(d.moves[0].uci).toBe('e1g1');
  });
});
