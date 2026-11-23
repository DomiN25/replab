// Eröffnungs-Statistik aus den eigenen Partien: je Farbe und Eröffnungsfamilie Partien, Siege/Remis/Niederlagen und Punkte.
// Dazu die stärkste und schwächste Eröffnung (mit Mindestanzahl) und die häufigsten Fehlerstellen. UI-frei, getestet.
import type { GameRec } from './opponentStats';
import type { Assessment, GameReview } from './gameReview';

export interface OpeningStat {
  family: string;
  n: number;
  w: number;
  d: number;
  l: number;
  /** Punkte in Prozent (Sieg 1, Remis ½) */
  score: number;
  /** Partien, in denen du nach der Abweichung schlechter standest (nur wo bewertet) */
  flagged: number;
}

export function openingStats(
  games: { game: GameRec; key: string }[],
  color: 'w' | 'b',
  famOf: (key: string) => string | undefined,
  flagged?: (key: string) => boolean,
): OpeningStat[] {
  const m = new Map<string, OpeningStat>();
  for (const { game, key } of games) {
    if (game.c !== color) continue;
    const family = famOf(key) ?? 'Sonstige';
    let s = m.get(family);
    if (!s) m.set(family, (s = { family, n: 0, w: 0, d: 0, l: 0, score: 0, flagged: 0 }));
    s.n++;
    if (game.r === 1) s.w++;
    else if (game.r === 0) s.d++;
    else s.l++;
    if (flagged?.(key)) s.flagged++;
  }
  return [...m.values()].map((s) => ({ ...s, score: Math.round((100 * (s.w + s.d / 2)) / s.n) })).sort((a, b) => b.n - a.n || b.score - a.score);
}

/** Stärkste und schwächste Eröffnung mit mindestens `min` Partien (bei Gleichstand die häufigere). */
export function bestWorst(stats: OpeningStat[], min = 3): { best?: OpeningStat; worst?: OpeningStat } {
  const ok = stats.filter((s) => s.n >= min && s.family !== 'Sonstige');
  if (!ok.length) return {};
  const best = [...ok].sort((a, b) => b.score - a.score || b.n - a.n)[0];
  const worst = [...ok].sort((a, b) => a.score - b.score || b.n - a.n)[0];
  return { best, worst: worst === best ? undefined : worst };
}

export interface ErrorSpot {
  kind: 'dev' | 'opp' | 'hole' | 'mistake';
  /** Züge (SAN) bis einschließlich des Fehlers bzw. Ereignis-Zugs */
  sans: string[];
  /** Halbzug-Index des Zugs */
  ply: number;
  n: number;
  /** durchschnittliche Bewertung danach (cp, aus meiner Sicht), falls bekannt */
  avgCp?: number;
  /** Schlüssel der betroffenen Partien */
  keys: string[];
  /** erste Partie für „Ansehen“ / Weg ins Repertoire */
  rev: GameReview;
}

/**
 * Häufigste Fehlerstellen: Abweichungen/unvorbereitete Gegnerzüge, nach denen du schlechter standest, und eigene grobe Fehler
 * aus der Lichess-Analyse – gleiche Zugfolge zusammengefasst, häufigste zuerst.
 */
export function errorSpots(items: { game: GameRec; rev: GameReview; key: string; a?: Assessment }[], max = 6): ErrorSpot[] {
  const m = new Map<string, ErrorSpot & { cps: number[] }>();
  const add = (kind: ErrorSpot['kind'], sans: string[], ply: number, key: string, rev: GameReview, cp?: number) => {
    const k = `${kind}|${sans.join(' ')}`;
    let s = m.get(k);
    if (!s) m.set(k, (s = { kind, sans, ply, n: 0, keys: [], rev, cps: [] }));
    s.n++;
    s.keys.push(key);
    if (cp !== undefined) s.cps.push(cp);
  };
  for (const { game, rev, key, a } of items) {
    const sans = game.m.split(' ').filter(Boolean);
    if (a?.verdict === 'flag' && rev.ply !== undefined && rev.status !== 'in-rep' && rev.status !== 'end') {
      const kind = rev.status === 'my-deviation' ? 'dev' : rev.status === 'opp-new' ? 'opp' : 'hole';
      add(kind, sans.slice(0, rev.ply + 1), rev.ply, key, rev, a.cp);
    }
    if (rev.mistake) add('mistake', sans.slice(0, rev.mistake.ply + 1), rev.mistake.ply, key, rev, -rev.mistake.drop);
  }
  return [...m.values()]
    .map(({ cps, ...s }) => ({ ...s, avgCp: cps.length ? Math.round(cps.reduce((x, y) => x + y, 0) / cps.length) : undefined }))
    .sort((a, b) => b.n - a.n || (a.avgCp ?? 0) - (b.avgCp ?? 0))
    .slice(0, max);
}
