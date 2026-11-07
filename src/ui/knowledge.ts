// Wissens-Heatmap: Abrufwahrscheinlichkeit R je eigener Stellung, Gegner-Äste als gewichteter Mittelwert.
import type { Graph } from '../core/graph';

export interface Agg {
  mean?: number; // 0..1, undefined = nur neue/ungelernte Karten
  w: number;
  gap: boolean; // direkte Lücke
}

/**
 * Für jeden Knoten der Mittelwert von R über den Unterbaum.
 * - Stellung mit mir am Zug: eigene Karte (Gewicht 1) + Unterbaum; Lücke zählt als 0 (rot).
 * - Stellung mit Gegner am Zug: Kinder gewichtet nach Anteil (unbekannt → gleich verteilt).
 */
export function knowledgeAgg(g: Graph, rOf: (posKey: string) => number | undefined): Map<number, Agg> {
  const memo = new Map<number, Agg>();
  const visiting = new Set<number>();
  const val = (id0: number): Agg => {
    const n0 = g.nodes[id0];
    const id = n0.status === 'transposition' ? n0.transposeOf! : id0;
    const hit = memo.get(id);
    if (hit) return hit;
    if (visiting.has(id)) return { w: 0, gap: false };
    visiting.add(id);
    const n = g.nodes[id];
    let res: Agg;
    if (n.toMove === 'me') {
      if (n.status === 'gap') res = { mean: 0, w: 1, gap: true };
      else {
        const own = rOf(n.posKey);
        let sum = 0;
        let w = 0;
        if (own !== undefined && n.status === 'answered') {
          sum += own;
          w += 1;
        }
        for (const c of n.children) {
          const a = val(c);
          if (a.mean !== undefined && a.w > 0) {
            sum += a.mean * a.w;
            w += a.w;
          }
        }
        res = { mean: w > 0 ? sum / w : undefined, w: Math.max(w, own !== undefined ? 1 : 0), gap: false };
      }
    } else {
      const kids = n.children.map((c) => ({ a: val(c), s: g.nodes[c].share }));
      const known = kids.some((k) => (k.s ?? 0) > 0);
      let sum = 0;
      let w = 0;
      for (const k of kids) {
        const f = known ? k.s ?? 0 : 1 / Math.max(1, kids.length);
        if (k.a.mean !== undefined && k.a.w > 0 && f > 0) {
          sum += k.a.mean * f;
          w += f;
        }
      }
      res = { mean: w > 0 ? sum / w : undefined, w: w > 0 ? 1 : 0, gap: false };
    }
    visiting.delete(id);
    memo.set(id, res);
    return res;
  };
  for (let i = 0; i < g.nodes.length; i++) val(i);
  return memo;
}

export const KNOWLEDGE_COLORS = {
  green: '#46e3ad',
  yellow: '#f5d34a',
  red: '#ff6b6b',
  grey: '#5b6880',
};
