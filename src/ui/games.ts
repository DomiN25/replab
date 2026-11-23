// Meine Partien (Lichess und Chess.com): laden, lokal speichern (nur dieses Gerät, nicht im Sync) und als Statistik bereitstellen.
import { useMemo, useSyncExternalStore } from 'react';
import { buildOppStats, positionResults, type GameRec, type OppStats, type PosResult } from '../core/opponentStats';
import type { Color } from '../core/types';
import { fetchLichessGames } from '../services/lichessGames';
import { fetchChesscomGames } from '../services/chesscomGames';

const KEY = 'replab.games';

export type GameSource = 'lichess' | 'chesscom';
export const SOURCE_NAME: Record<GameSource, string> = { lichess: 'Lichess', chesscom: 'Chess.com' };

export interface StoredGames {
  /** je Quelle: Benutzername und Ladezeitpunkt */
  sources: Partial<Record<GameSource, { user: string; fetchedAt: number }>>;
  games: GameRec[];
}

function read(): StoredGames | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as StoredGames & { user?: string; fetchedAt?: number };
    if (!Array.isArray(p.games)) return undefined;
    // älteres Format (nur Lichess): { user, fetchedAt, games }
    if (!p.sources) return { sources: { lichess: { user: p.user ?? '', fetchedAt: p.fetchedAt ?? 0 } }, games: p.games.map((g) => ({ ...g, src: g.src ?? 'lichess' })) };
    return p;
  } catch {
    return undefined;
  }
}

let state: StoredGames | undefined = read();
const listeners = new Set<() => void>();
const set = (s: StoredGames | undefined) => {
  state = s && s.games.length + Object.keys(s.sources).length > 0 ? s : undefined;
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* voll/blockiert: bleibt bis zum Neuladen im Speicher */
  }
  listeners.forEach((l) => l());
};

/** Partien einer Quelle laden und ersetzen (die der anderen Quelle bleiben). Gibt die Anzahl zurück. */
export async function loadMyGames(source: GameSource, user: string, max: number, token: string | undefined, onProgress?: (n: number) => void): Promise<number> {
  const games =
    source === 'lichess' ? await fetchLichessGames(user, { max, token, onProgress }) : await fetchChesscomGames(user, { max, onProgress });
  const rest = (state?.games ?? []).filter((g) => (g.src ?? 'lichess') !== source);
  set({
    sources: { ...state?.sources, [source]: { user: user.trim(), fetchedAt: Date.now() } },
    games: [...rest, ...games].sort((a, b) => (b.t ?? 0) - (a.t ?? 0)),
  });
  return games.length;
}

/** stabiler Schlüssel einer Partie (Quelle + ID) */
export const gameKey = (g: GameRec) => `${g.src ?? 'lichess'}:${g.id ?? g.url ?? g.t}`;

/**
 * Nur neue Partien seit der letzten geladenen holen und dazumischen (Start der App). Ohne gespeicherte Partien dieser Quelle:
 * die letzten 100. Gibt die Anzahl neuer Partien zurück.
 */
export async function loadNewGames(source: GameSource, user: string, token: string | undefined): Promise<number> {
  const mine = (state?.games ?? []).filter((g) => (g.src ?? 'lichess') === source);
  const since = mine.length ? Math.max(...mine.map((g) => g.t ?? 0)) : undefined;
  const fresh =
    source === 'lichess'
      ? await fetchLichessGames(user, { max: 100, token, since })
      : await fetchChesscomGames(user, { max: 100, since });
  const known = new Set((state?.games ?? []).map(gameKey));
  const add = fresh.filter((g) => !known.has(gameKey(g)));
  if (!add.length && state?.sources[source]?.user === user.trim()) return 0;
  set({
    sources: { ...state?.sources, [source]: { user: user.trim(), fetchedAt: Date.now() } },
    games: [...(state?.games ?? []), ...add].sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, 600),
  });
  return add.length;
}

export function clearMyGames(source?: GameSource) {
  if (!source || !state) return set(undefined);
  const sources = { ...state.sources };
  delete sources[source];
  set({ sources, games: state.games.filter((g) => (g.src ?? 'lichess') !== source) });
}

export function useMyGames(): StoredGames | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let posCache: { s: StoredGames | undefined; color: Color; m: Map<string, PosResult> } | undefined;
/** Bilanz je Stellung aus meinen Partien (gecacht, solange sich die Partien nicht ändern) */
export function positionResultsFor(color: Color): Map<string, PosResult> {
  if (!posCache || posCache.s !== state || posCache.color !== color) posCache = { s: state, color, m: positionResults(state?.games ?? [], color) };
  return posCache.m;
}
export function usePositionResults(color: Color): Map<string, PosResult> | undefined {
  const stored = useMyGames();
  return useMemo(() => (stored?.games.length ? positionResultsFor(color) : undefined), [stored, color]);
}

/** Statistik für die Farbe des aktuellen Repertoires (undefined, solange keine Partien geladen sind). */
export function useOppStats(color: Color): OppStats | undefined {
  const stored = useMyGames();
  return useMemo(() => (stored?.games.length ? buildOppStats(stored.games, color) : undefined), [stored, color]);
}
