// Lückentour (geführter Aufbau): welche Lücke kommt als Nächstes?
import { gapList, pathUcis, type GapInfo, type Graph } from './graph';
import { commonPrefix } from './session';

export type GuideStrategy = 'branch' | 'shallow' | 'line';

export interface GuideOptions {
  strategy: GuideStrategy;
  minReach: number; // 0..1
  skipped: Set<string>; // posKeys, die in dieser Runde übersprungen wurden
  /** Weg (UCI) der zuletzt bearbeiteten Stellung – für „Ast für Ast“ und „Linie zu Ende“. */
  lastPath?: string[];
  /** Ast der zuletzt bearbeiteten Lücke – „Ast für Ast“ bleibt dort, bis er leer ist. */
  lastFamily?: string;
  /** Nur Lücken dieses Asts oder dieser (feineren) Familie, leer = alle. */
  family?: string;
  /** Zufallsquelle (0..1): nur beim Start einer Tour (ohne lastPath) – variiert die erste Lücke statt immer dieselbe zu nehmen. */
  rng?: () => number;
}

/** Zufallswahl unter den ersten `top` Einträgen (Start der Tour). */
function pickTop<T>(list: T[], rng: (() => number) | undefined, top: number): T {
  if (!rng || list.length < 2) return list[0];
  return list[Math.floor(rng() * Math.min(list.length, top))];
}

/** Offene Lücken unter den Filtern, Grundsortierung: flach vor tief, dann häufiger. */
function candidates(g: Graph, o: Pick<GuideOptions, 'minReach' | 'skipped' | 'family'>): GapInfo[] {
  return gapList(g, 'depth').filter(
    (x) => !o.skipped.has(x.posKey) && (o.minReach <= 0 || x.reach >= o.minReach) && (!o.family || x.branch === o.family || x.family === o.family),
  );
}

/**
 * Nächste Lücke:
 * - branch („Ast für Ast“): bleibt im Ast der letzten Lücke, bis er leer ist; danach der Ast mit der größten Summe
 *   an Erreichbarkeit. Ast = Linie nach der ersten Gegnerantwort (topFamily, strukturell) – Eröffnungsnamen wären
 *   zu fein (2…Sc6 „Königsspringerspiel“ und 2…Sf6 „Russisch“ sind Geschwister). Innerhalb des Asts flach vor tief, bei gleicher Tiefe die Linie mit dem
 *   längsten gemeinsamen Weg zur letzten Lücke (ähnliche Linien direkt hintereinander), dann häufiger.
 * - shallow: am nächsten an der Grundstellung über alle Äste, bei Gleichstand häufigere zuerst.
 * - line („Linie zu Ende“): möglichst tief in der zuletzt bearbeiteten Linie (längster gemeinsamer Weg), dann wie shallow.
 */
export function nextGap(g: Graph, o: GuideOptions): GapInfo | undefined {
  let list = candidates(g, o);
  if (!list.length) return undefined;
  const cpOf = (gp: GapInfo) => (o.lastPath?.length ? commonPrefix(pathUcis(g, gp.id), o.lastPath) : 0);

  if (o.strategy === 'branch') {
    const inLast = o.lastFamily ? list.filter((x) => x.branch === o.lastFamily) : [];
    if (inLast.length) list = inLast;
    else {
      const weight = new Map<string, number>();
      for (const x of list) weight.set(x.branch, (weight.get(x.branch) ?? 0) + x.reach);
      let best = list[0].branch;
      for (const [f, w] of weight) if (w > (weight.get(best) ?? 0)) best = f;
      // Start der Tour: Ast zufällig, gewichtet nach Erreichbarkeit (große Äste öfter, aber nicht immer derselbe)
      if (o.rng && !o.lastPath?.length) {
        let r = o.rng() * [...weight.values()].reduce((a, b) => a + b, 0);
        for (const [f, w] of weight) {
          r -= w;
          if (r <= 0) {
            best = f;
            break;
          }
        }
      }
      list = list.filter((x) => x.branch === best);
    }
    const cp = new Map(list.map((x) => [x.id, cpOf(x)]));
    const sorted = [...list].sort((a, b) => a.ply - b.ply || cp.get(b.id)! - cp.get(a.id)! || b.reach - a.reach);
    return o.lastPath?.length ? sorted[0] : pickTop(sorted, o.rng, 4);
  }

  if (o.strategy === 'line' && o.lastPath?.length) {
    let best = list[0];
    let bestCp = -1;
    for (const gp of list) {
      const cp = cpOf(gp);
      if (cp > bestCp || (cp === bestCp && (gp.ply < best.ply || (gp.ply === best.ply && gp.reach > best.reach)))) {
        best = gp;
        bestCp = cp;
      }
    }
    return best;
  }
  return o.lastPath?.length ? list[0] : pickTop(list, o.rng, 5); // gapList('depth') ist schon nach Tiefe, dann Erreichbarkeit sortiert
}

/** Äste mit offenen Lücken, nach Anzahl absteigend – für die Ast-Auswahl. */
export function gapFamilies(g: Graph, o: Pick<GuideOptions, 'minReach' | 'skipped'>): { family: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of candidates(g, o)) m.set(x.branch, (m.get(x.branch) ?? 0) + 1);
  return [...m].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family, 'de'));
}

/** Anzahl offener Lücken unter den aktuellen Filtern. */
export function openGapCount(g: Graph, o: Pick<GuideOptions, 'minReach' | 'skipped' | 'family'>): number {
  return g.gaps.filter((id) => {
    const n = g.nodes[id];
    return (
      !o.skipped.has(n.posKey) && (o.minReach <= 0 || n.reach >= o.minReach) && (!o.family || n.topFamily === o.family || n.family === o.family)
    );
  }).length;
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
