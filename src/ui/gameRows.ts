// Meine Partien gegen das aktuelle Repertoire geprüft – gemeinsam für die Partien-Seite und die Lücken („aus deinen Partien“).
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { reviewGame, type RepView, type Reviewed } from '../core/gameReview';
import { useApp } from './store';
import { useMyGames } from './games';

export interface Row extends Reviewed {
  key: string;
}

/** Repertoire-Sicht für die Prüfung (eigener Zug, bekannte Stellungen, Ende-Marker) */
export function useRepView(): RepView {
  const moves = useApp((s) => s.moves);
  const marks = useApp((s) => s.marks);
  const graph = useApp((s) => s.graph);
  return useMemo(
    () => ({
      myMove: (k) => {
        const m = moves.get(k);
        return m ? { uci: m.uci, san: m.san } : undefined;
      },
      known: (k) => !!graph?.byPosKey.has(k),
      isEnd: (k) => !!marks.get(k)?.endOfLine,
    }),
    [moves, marks, graph],
  );
}

/** Alle geladenen Partien in der Farbe des aktuellen Repertoires, je mit Prüfergebnis (neueste zuerst).
 *  enabled = false: nichts berechnen (z. B. vorgeladene Lücken-Seite neben dem Repertoire – jeder Zug dort würde sonst neu prüfen). */
export function useReviewedGames(enabled = true): { rows: Row[]; color: 'white' | 'black'; loaded: boolean } {
  const stored = useMyGames();
  const color = useApp((s) => s.repertoires.find((r) => r.id === s.repId)?.color ?? 'white');
  const view = useRepView();
  const mine = useMemo(() => (stored?.games ?? []).filter((g) => g.c === (color === 'white' ? 'w' : 'b')), [stored, color]);
  const deferred = useDeferredValue(mine);
  const rows = useMemo(
    () => (!enabled ? [] : deferred).map((g, i) => ({ game: g, rev: reviewGame(g, color, view), key: g.id ? `${g.src ?? 'lichess'}:${g.id}` : `${g.src ?? 'l'}${i}` })),
    [deferred, color, view, enabled],
  );
  return { rows, color, loaded: !!stored?.games.length };
}

let ecoCache: Record<string, string> | undefined;
/** Eröffnungsnamen (posKey → Lichess-Name), bei Bedarf nachgeladen (eigener Chunk, ~430 KB). */
export function useEco(enabled = true): Record<string, string> | undefined {
  const [eco, setEco] = useState(ecoCache);
  useEffect(() => {
    if (!enabled || ecoCache) return;
    let live = true;
    void import('../data/openings.json').then((m) => {
      ecoCache = m.default as Record<string, string>;
      if (live) setEco(ecoCache);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return eco;
}
