// Geführter Aufbau: welche Lücke kommt als Nächstes?
import { gapList, pathUcis, type GapInfo, type Graph } from './graph';
import { commonPrefix } from './session';

export type GuideStrategy = 'shallow' | 'line';

export interface GuideOptions {
  strategy: GuideStrategy;
  minReach: number; // 0..1
  skipped: Set<string>; // posKeys, die in dieser Runde übersprungen wurden
  /** Weg (UCI) der zuletzt bearbeiteten Stellung – für „in der Linie bleiben“. */
  lastPath?: string[];
}

/**
 * Nächste Lücke:
 * - shallow: am nächsten an der Grundstellung (wenigste Halbzüge), bei Gleichstand häufigere zuerst.
 * - line: möglichst tief in der zuletzt bearbeiteten Linie (längster gemeinsamer Weg), dann wie shallow.
 */
export function nextGap(g: Graph, o: GuideOptions): GapInfo | undefined {
  const list = gapList(g, 'depth').filter((x) => !o.skipped.has(x.posKey) && (o.minReach <= 0 || x.reach >= o.minReach));
  if (!list.length) return undefined;
  if (o.strategy === 'line' && o.lastPath?.length) {
    let best = list[0];
    let bestCp = -1;
    for (const gp of list) {
      const cp = commonPrefix(pathUcis(g, gp.id), o.lastPath);
      if (cp > bestCp || (cp === bestCp && (gp.ply < best.ply || (gp.ply === best.ply && gp.reach > best.reach)))) {
        best = gp;
        bestCp = cp;
      }
    }
    return best;
  }
  return list[0]; // gapList('depth') ist schon nach Tiefe, dann Erreichbarkeit sortiert
}

/** Anzahl offener Lücken unter den aktuellen Filtern. */
export function openGapCount(g: Graph, o: Pick<GuideOptions, 'minReach' | 'skipped'>): number {
  return g.gaps.filter((id) => !o.skipped.has(g.nodes[id].posKey) && (o.minReach <= 0 || g.nodes[id].reach >= o.minReach)).length;
}

export interface Sibling {
  id: number;
  uci: string;
  san: string;
  share?: number;
  status: 'gap' | 'answered' | 'end' | 'other';
}

/** Andere Gegnerzüge in derselben Stellung (für „zu einem anderen Zug wechseln“). */
export function oppSiblings(g: Graph, gapId: number): Sibling[] {
  const n = g.nodes[gapId];
  if (n.parent < 0) return [];
  const parent = g.nodes[n.parent];
  if (parent.toMove !== 'opp') return [];
  return parent.children.map((cid) => {
    const c = g.nodes[cid];
    const canon = c.status === 'transposition' ? g.nodes[c.transposeOf!] : c;
    const status = canon.status === 'gap' ? 'gap' : canon.status === 'answered' ? 'answered' : canon.status === 'end' ? 'end' : 'other';
    return { id: cid, uci: c.uci!, san: c.san!, share: c.share, status };
  });
}
