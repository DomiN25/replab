// Eigene Chess.com-Partien laden (öffentliche API ohne Anmeldung): Monatsarchive, neueste zuerst.
import { MAX_PLIES, type GameRec } from '../core/opponentStats';
import { readPgn } from '../core/pgn';

interface CcPlayer {
  username?: string;
  result?: string;
}
export interface CcGame {
  url?: string;
  pgn?: string;
  rules?: string;
  rated?: boolean;
  time_class?: string;
  end_time?: number;
  white?: CcPlayer;
  black?: CcPlayer;
}

/** SAN-Züge aus dem PGN (ohne Kommentare/Uhrzeiten); undefined bei kaputtem PGN. */
export function pgnMoves(pgn: string): string[] | undefined {
  try {
    const g = readPgn(pgn)[0];
    if (!g) return undefined;
    const out: string[] = [];
    for (const n of g.moves.mainline()) out.push(n.san);
    return out;
  } catch {
    return undefined;
  }
}

/** API-Partie → kompakter Datensatz aus meiner Sicht; undefined bei Varianten, Fremdstellung oder fremdem Namen. */
export function toGameRecCc(g: CcGame, userId: string): GameRec | undefined {
  if (!g.pgn || (g.rules && g.rules !== 'chess') || /\[(FEN|SetUp)\s/.test(g.pgn)) return undefined;
  const w = g.white?.username?.toLowerCase();
  const b = g.black?.username?.toLowerCase();
  const c = w === userId ? 'w' : b === userId ? 'b' : undefined;
  if (!c) return undefined;
  const me = c === 'w' ? g.white : g.black;
  const other = c === 'w' ? g.black : g.white;
  const r = me?.result === 'win' ? 1 : other?.result === 'win' ? -1 : 0; // alles andere (Remisarten) = Remis
  const moves = pgnMoves(g.pgn);
  if (!moves?.length) return undefined;
  const id = g.url?.split('/').pop();
  return {
    c,
    r,
    m: moves.slice(0, MAX_PLIES).join(' '),
    t: g.end_time ? g.end_time * 1000 : undefined,
    src: 'chesscom',
    id,
    opp: other?.username,
    url: g.url,
  };
}

export interface CcFetchOptions {
  max: number;
  signal?: AbortSignal;
  onProgress?: (n: number) => void;
  fetchImpl?: typeof fetch;
}

export async function fetchChesscomGames(user: string, o: CcFetchOptions): Promise<GameRec[]> {
  const name = user.trim();
  if (!name) throw new Error('Bitte zuerst deinen Chess.com-Namen eintragen.');
  const id = name.toLowerCase();
  const f = o.fetchImpl ?? fetch;
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(id)}/games`;
  const res = await f(`${base}/archives`, { signal: o.signal });
  if (res.status === 404) throw new Error(`Chess.com kennt den Namen „${name}“ nicht.`);
  if (res.status === 429) throw new Error('Chess.com-Limit erreicht – bitte etwa eine Minute warten.');
  if (!res.ok) throw new Error(`Chess.com antwortet mit Fehler ${res.status}.`);
  const archives = ((await res.json()) as { archives?: string[] }).archives ?? [];
  const out: GameRec[] = [];
  // neueste Monate zuerst, bis genug Partien da sind (nacheinander: die API mag keine Parallelanfragen)
  for (const url of [...archives].reverse()) {
    if (out.length >= o.max) break;
    const r = await f(url, { signal: o.signal });
    if (!r.ok) {
      if (r.status === 429) throw new Error('Chess.com-Limit erreicht – bitte etwa eine Minute warten.');
      continue;
    }
    const games = ((await r.json()) as { games?: CcGame[] }).games ?? [];
    for (const g of [...games].reverse()) {
      const rec = toGameRecCc(g, id);
      if (rec) out.push(rec);
      if (out.length >= o.max) break;
    }
    o.onProgress?.(out.length);
  }
  return out;
}
