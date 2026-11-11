// Meine Lichess-Partien: laden, lokal speichern (nur dieses Gerät, nicht im Sync) und als Statistik bereitstellen.
import { useMemo, useSyncExternalStore } from 'react';
import { buildOppStats, type GameRec, type OppStats } from '../core/opponentStats';
import type { Color } from '../core/types';
import { fetchLichessGames } from '../services/lichessGames';

const KEY = 'replab.games';

export interface StoredGames {
  user: string;
  fetchedAt: number;
  games: GameRec[];
}

function read(): StoredGames | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as StoredGames;
    return Array.isArray(p.games) ? p : undefined;
  } catch {
    return undefined;
  }
}

let state: StoredGames | undefined = read();
const listeners = new Set<() => void>();
const set = (s: StoredGames | undefined) => {
  state = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* voll/blockiert: bleibt bis zum Neuladen im Speicher */
  }
  listeners.forEach((l) => l());
};

/** Partien von Lichess laden und ersetzen. Gibt die Anzahl zurück. */
export async function loadMyGames(user: string, max: number, token: string | undefined, onProgress?: (n: number) => void): Promise<number> {
  const games = await fetchLichessGames(user, { max, token, onProgress });
  set({ user: user.trim(), fetchedAt: Date.now(), games });
  return games.length;
}

export function clearMyGames() {
  set(undefined);
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

/** Statistik für die Farbe des aktuellen Repertoires (undefined, solange keine Partien geladen sind). */
export function useOppStats(color: Color): OppStats | undefined {
  const stored = useMyGames();
  return useMemo(() => (stored?.games.length ? buildOppStats(stored.games, color) : undefined), [stored, color]);
}
