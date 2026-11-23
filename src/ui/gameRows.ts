// Meine Partien gegen das aktuelle Repertoire geprüft – gemeinsam für die Partien-Seite und die Lücken („aus deinen Partien“).
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { repo } from '../data/repo';
import { reviewGame, type RepView, type Reviewed } from '../core/gameReview';
import { useApp } from './store';
import { gameKey, useMyGames } from './games';

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
    () => (!enabled ? [] : deferred).map((g) => ({ game: g, rev: reviewGame(g, color, view), key: gameKey(g) })),
    [deferred, color, view, enabled],
  );
  return { rows, color, loaded: !!stored?.games.length };
}

/**
 * Die neuesten Partien beider Farben (Startseite), jede gegen das Repertoire ihrer Farbe geprüft: die Farbe des aktiven
 * Repertoires wie überall, die andere gegen deren Hauptrepertoire. Dort gibt es keinen berechneten Baum – „bekannt“ heißt
 * dann: eigener Zug oder Ende-Marker vorhanden (Lücken erscheinen dort als „Gegner unvorbereitet“).
 */
export function useRecentBoth(n: number, enabled: boolean): Row[] {
  const stored = useMyGames();
  const reps = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  const cur = reps.find((r) => r.id === repId);
  const view = useRepView();
  const otherColor = cur?.color === 'black' ? 'white' : 'black';
  const other = reps.find((r) => r.color === otherColor && r.isMain) ?? reps.find((r) => r.color === otherColor);
  const [otherView, setOtherView] = useState<RepView>();
  useEffect(() => {
    if (!enabled || !other) return;
    let live = true;
    void Promise.all([repo.getMoves(other.id), repo.getMarks(other.id)]).then(([mv, mk]) => {
      if (!live) return;
      const moves = new Map(mv.map((m) => [m.posKey, m]));
      const ends = new Set(mk.filter((m) => m.endOfLine).map((m) => m.posKey));
      setOtherView({
        myMove: (k) => {
          const m = moves.get(k);
          return m ? { uci: m.uci, san: m.san } : undefined;
        },
        known: (k) => moves.has(k) || ends.has(k),
        isEnd: (k) => ends.has(k),
      });
    });
    return () => {
      live = false;
    };
  }, [enabled, other?.id, other?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!enabled || !stored || !cur) return [];
    const curC = cur.color === 'white' ? 'w' : 'b';
    const out: Row[] = [];
    for (const g of stored.games) {
      if (out.length >= n) break;
      if (g.c === curC) out.push({ game: g, rev: reviewGame(g, cur.color, view), key: gameKey(g) });
      else if (otherView) out.push({ game: g, rev: reviewGame(g, otherColor, otherView), key: gameKey(g) });
      else if (!other) continue; // kein Repertoire dieser Farbe
      else return out; // anderes Repertoire lädt noch – erst dann vollständig
    }
    return out;
  }, [enabled, stored, cur, view, otherView, other, otherColor, n]);
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
