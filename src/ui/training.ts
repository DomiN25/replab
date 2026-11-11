// Auswahl der Karten für eine Sitzung (UI-unabhängig genug, aber braucht Graph + Karten).
import type { Graph } from '../core/graph';
import { lineOrder, pathUcis, subtreeIds } from '../core/graph';
import type { SessionItem } from '../core/session';
import { dayKey, isDue, isNew, Scheduler } from '../core/srs';
import type { Card, RepertoireMove, ReviewLog, Settings } from '../core/types';

export interface Focus {
  nodeId?: number; // nur dieser Ast
  onlyWeak?: boolean; // nur R < 0,7
}

export interface Pool {
  due: Card[];
  fresh: Card[];
  reviewsToday: number;
  newToday: number;
}

export function inFocus(g: Graph | undefined, focus: Focus | undefined): ((posKey: string) => boolean) | undefined {
  if (!g || focus?.nodeId === undefined) return undefined;
  const keys = new Set(subtreeIds(g, focus.nodeId).map((i) => g.nodes[i].posKey));
  return (k) => keys.has(k);
}

export function buildPool(cards: Card[], logs: ReviewLog[], settings: Settings, now: number, g?: Graph, focus?: Focus): Pool {
  const today = dayKey(now);
  // Studien-Abfragen zählen nicht gegen die Tageslimits des Repertoire-Trainings
  const todays = logs.filter((l) => dayKey(l.at) === today && l.mode !== 'study');
  const newToday = new Set(todays.filter((l) => l.mode === 'new').map((l) => l.cardId)).size;
  const sch = new Scheduler(settings.srs.desiredRetention);
  const filt = inFocus(g, focus);
  let pool = cards.filter((c) => !c.suspended && (!filt || filt(c.posKey)));
  if (focus?.onlyWeak) pool = pool.filter((c) => !isNew(c.srs) && (sch.retrievability(c.srs, now) ?? 1) < 0.7);
  return {
    due: pool.filter((c) => isDue(c.srs, now) || (focus?.onlyWeak && !isNew(c.srs))),
    fresh: pool.filter((c) => isNew(c.srs)),
    reviewsToday: todays.filter((l) => l.mode !== 'new').length,
    newToday,
  };
}

export function pathOf(g: Graph | undefined, posKey: string): string[] | undefined {
  const id = g?.byPosKey.get(posKey);
  return id !== undefined ? pathUcis(g!, id) : undefined;
}

/** Fällige Karten: Priorität = Überfälligkeit (Tage) + Erreichwahrscheinlichkeit. */
export function dueItems(pool: Pool, settings: Settings, now: number, g?: Graph): SessionItem[] {
  const limit = Math.max(0, settings.srs.maxReviewsPerDay - pool.reviewsToday);
  const items = pool.due.map((c) => {
    const id = g?.byPosKey.get(c.posKey);
    const reach = id !== undefined ? g!.nodes[id].reach : 0;
    return { cardId: c.id, posKey: c.posKey, path: pathOf(g, c.posKey), priority: (now - c.srs.due) / 86400_000 + reach };
  });
  items.sort((a, b) => b.priority - a.priority);
  return items.slice(0, limit);
}

/** Neue Karten, die nach der Mindest-Erreichbarkeit überhaupt in Frage kommen (Rest bleibt zurückgestellt). */
export function eligibleNew(pool: Pool, settings: Settings, g?: Graph): Card[] {
  const min = settings.srs.newMinReach ?? 0;
  if (!g || min <= 0) return pool.fresh;
  return pool.fresh.filter((c) => {
    const id = g.byPosKey.get(c.posKey);
    return id !== undefined && g.nodes[id].reach >= min;
  });
}

/**
 * Neue Karten für heute: Tageslimit (+ freiwillige Extra-Karten), nur ab Mindest-Erreichbarkeit.
 * Reihenfolge „reach“: wahrscheinlichste Stellungen zuerst (Eltern vor Kindern, da Erreichbarkeit entlang der Linie
 * nur sinkt) – sinnvoll nach großen Importen. „line“: Linie für Linie (Tiefensuche, häufige Gegnerzüge zuerst).
 */
export function newItems(pool: Pool, settings: Settings, g?: Graph, extra = 0): SessionItem[] {
  const limit = Math.max(0, settings.srs.newPerDay - pool.newToday) + extra;
  const eligible = eligibleNew(pool, settings, g);
  if ((settings.srs.newOrder ?? 'reach') === 'reach' && g) {
    const info = (c: Card) => {
      const id = g.byPosKey.get(c.posKey);
      return id !== undefined ? { reach: g.nodes[id].reach, ply: g.nodes[id].ply } : { reach: -1, ply: 999 };
    };
    const sorted = eligible.map((c) => ({ c, ...info(c) })).sort((a, b) => b.reach - a.reach || a.ply - b.ply);
    return sorted.slice(0, limit).map(({ c }, i) => ({ cardId: c.id, posKey: c.posKey, path: pathOf(g, c.posKey), priority: -i }));
  }
  const byKey = new Map(eligible.map((c) => [c.posKey, c]));
  const ordered: Card[] = [];
  if (g) {
    for (const id of lineOrder(g)) {
      const c = byKey.get(g.nodes[id].posKey);
      if (c) {
        ordered.push(c);
        byKey.delete(c.posKey);
      }
    }
  }
  ordered.push(...byKey.values()); // nicht erreichbare zuletzt
  return ordered.slice(0, limit).map((c, i) => ({ cardId: c.id, posKey: c.posKey, path: pathOf(g, c.posKey), priority: -i }));
}

/** Linien-Modus: zufällige Linie (gewichtet nach Anteil) im Fokus-Ast, alle eigenen Züge darauf. */
export function lineItems(cards: Card[], g: Graph, startId: number, rand = Math.random): SessionItem[] {
  const byKey = new Map(cards.map((c) => [c.posKey, c]));
  const out: SessionItem[] = [];
  let id = startId;
  const seen = new Set<number>();
  for (;;) {
    const n0 = g.nodes[id];
    const n = n0.status === 'transposition' ? g.nodes[n0.transposeOf!] : n0;
    if (seen.has(n.id)) break;
    seen.add(n.id);
    if (n.toMove === 'me') {
      const c = byKey.get(n.posKey);
      if (c && n.status === 'answered') out.push({ cardId: c.id, posKey: c.posKey, path: pathUcis(g, n.id), priority: 0 });
    }
    if (!n.children.length) break;
    if (n.toMove === 'me') id = n.children[0];
    else {
      const kids = n.children.map((k) => g.nodes[k]);
      const total = kids.reduce((s, k) => s + (k.share ?? 0), 0);
      let r = rand() * (total || kids.length);
      let pick = kids[kids.length - 1];
      for (const k of kids) {
        r -= total ? k.share ?? 0 : 1;
        if (r <= 0) {
          pick = k;
          break;
        }
      }
      id = pick.id;
    }
  }
  return out;
}

export interface Prepared {
  cardId: string;
  card: Card;
  move?: RepertoireMove;
  /** FENs des Kontexts (ältester zuerst) inkl. Zielstellung als letztes Element */
  context: { fen: string; uci?: string }[];
}
