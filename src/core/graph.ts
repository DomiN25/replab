// Repertoire-Graph (Pflichtenheft 4.3): Stellungen als Knoten, ab Grundstellung als Baum ausgerollt.
// Zugumstellungen werden NICHT erneut ausgerollt, sondern als Verweisknoten (⇄) angelegt.
// Enthält Lückenregel (F3) und Erreichwahrscheinlichkeit (F6).
import { START_FEN, playUci, posKeyOf, turnOf } from './chess';
import { oppCandidates, type RelevanceSettings } from './relevance';
import { familyDe, nameDe } from './openings';
import type { Color, EngineData, ExplorerData, PositionMark, Side } from './types';

export type NodeStatus =
  | 'answered' // ich am Zug, Eintrag vorhanden
  | 'gap' // ich am Zug, kein Eintrag, kein Ende-Marker → Lücke
  | 'end' // Ende-Marker gesetzt
  | 'open' // Gegner am Zug, relevante Züge bekannt
  | 'leaf' // Gegner am Zug, keine relevanten Züge bekannt (oder Tiefenlimit)
  | 'transposition'; // Verweis auf erste Fundstelle

export interface GNode {
  id: number;
  parent: number; // -1 = Wurzel
  posKey: string;
  fen: string;
  ply: number; // absolute Halbzugzahl (0 = Grundstellung)
  uci?: string;
  san?: string;
  by?: Side; // wer den Zug hierher gemacht hat
  toMove: Side;
  children: number[];
  status: NodeStatus;
  transposeOf?: number;
  share?: number; // Anteil des Gegnerzugs (0..1), falls bekannt
  games?: number;
  trap?: boolean;
  lossCp?: number;
  reach: number;
  name?: string; // geerbter Eröffnungsname (deutsch, so weit möglich)
  family: string; // tiefste bekannte Familie (für Lückenliste)
  topFamily: string; // Familie auf Ebene „nach 2 Halbzügen“ (für Galaxie-Farben)
  needsData?: boolean; // Gegner am Zug, Explorer-Daten fehlen noch
  needsEngine?: boolean; // Gegner am Zug, zu wenig Partien, keine Engine-Daten
}

export interface GraphInput {
  color: Color;
  rootFen?: string;
  entries: Map<string, { uci: string; san: string }>;
  marks: Map<string, PositionMark>;
  explorer: Map<string, ExplorerData>;
  engine: Map<string, EngineData>;
  /** Englischer Eröffnungsname aus der ECO-Tabelle (optional). */
  ecoName?: (posKey: string) => string | undefined;
  settings: RelevanceSettings;
  maxNodes?: number;
  maxPly?: number;
}

export interface Graph {
  color: Color;
  nodes: GNode[];
  byPosKey: Map<string, number>; // posKey → kanonischer Knoten (erste Fundstelle, BFS)
  gaps: number[];
  pending: number[];
  needsEngine: number[];
  orphans: string[]; // posKeys von Einträgen, die nicht erreichbar sind
  truncated: boolean;
}

const shortLabel = (s?: string) => (s && s.length <= 48 ? s : undefined);

export function buildGraph(input: GraphInput): Graph {
  const rootFen = input.rootFen ?? START_FEN;
  const maxNodes = input.maxNodes ?? 20000;
  const maxPly = input.maxPly ?? 80;
  const nodes: GNode[] = [];
  const byPosKey = new Map<string, number>();
  const engFamily: (string | undefined)[] = [];
  let truncated = false;
  const sideOf = (fen: string): Side => (turnOf(fen) === input.color ? 'me' : 'opp');

  const englishName = (posKey: string): string | undefined =>
    input.explorer.get(posKey)?.opening?.name ?? input.ecoName?.(posKey);

  const nameNode = (n: GNode, parent?: GNode) => {
    const label = shortLabel(input.marks.get(n.posKey)?.label);
    const eng = englishName(n.posKey);
    n.name = label ?? (eng ? nameDe(eng) : parent?.name);
    engFamily[n.id] = eng ? familyDe(eng) : parent ? engFamily[parent.id] : undefined;
    if (n.ply === 0) n.topFamily = 'Repertoire';
    else if (n.ply <= 2)
      n.topFamily = label ?? engFamily[n.id] ?? (parent && parent.ply > 0 ? parent.topFamily : undefined) ?? n.san ?? 'Sonstige';
    else n.topFamily = parent?.topFamily ?? 'Sonstige';
    n.family = engFamily[n.id] ?? n.topFamily;
  };

  const root: GNode = {
    id: 0,
    parent: -1,
    posKey: posKeyOf(rootFen),
    fen: rootFen,
    ply: 0,
    toMove: sideOf(rootFen),
    children: [],
    status: 'open',
    reach: 1,
    family: 'Repertoire',
    topFamily: 'Repertoire',
  };
  nodes.push(root);
  byPosKey.set(root.posKey, 0);
  nameNode(root);
  const queue: number[] = [0];

  const addChild = (parent: GNode, uci: string, by: Side, extra: Partial<GNode>) => {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    let played;
    try {
      played = playUci(parent.fen, uci);
    } catch {
      return; // illegaler Zug in Fremddaten
    }
    const existing = byPosKey.get(played.posKey);
    const node: GNode = {
      id: nodes.length,
      parent: parent.id,
      posKey: played.posKey,
      fen: played.fen,
      ply: parent.ply + 1,
      uci: played.uci,
      san: played.san,
      by,
      toMove: sideOf(played.fen),
      children: [],
      status: existing !== undefined ? 'transposition' : 'open',
      transposeOf: existing,
      reach: 0,
      family: '',
      topFamily: '',
      ...extra,
    };
    nodes.push(node);
    parent.children.push(node.id);
    nameNode(node, parent);
    if (existing === undefined) {
      byPosKey.set(played.posKey, node.id);
      queue.push(node.id);
    }
  };

  for (let head = 0; head < queue.length; head++) {
    const n = nodes[queue[head]];
    const mark = input.marks.get(n.posKey);
    if (mark?.endOfLine) {
      n.status = 'end';
      continue;
    }
    if (n.ply >= maxPly) {
      n.status = 'leaf';
      truncated = true;
      continue;
    }
    if (n.toMove === 'me') {
      const e = input.entries.get(n.posKey);
      if (!e) {
        n.status = 'gap';
        continue;
      }
      n.status = 'answered';
      addChild(n, e.uci, 'me', {});
    } else {
      const ex = input.explorer.get(n.posKey);
      const en = input.engine.get(n.posKey);
      const cands = oppCandidates({
        fen: n.fen,
        explorer: ex,
        engine: en,
        mark,
        settings: input.settings,
        childEngine: (k) => input.engine.get(k),
      });
      n.needsData = !ex;
      n.needsEngine = !!ex && ex.total < input.settings.minGames && !en;
      const rel = cands.filter((c) => c.relevant);
      n.status = rel.length ? 'open' : 'leaf';
      for (const c of rel) {
        addChild(n, c.uci, 'opp', { share: c.share, games: c.games, trap: c.trap, lossCp: c.lossCp });
      }
    }
  }

  computeReach(nodes, byPosKey);

  const gaps: number[] = [];
  const pending: number[] = [];
  const needsEngine: number[] = [];
  for (const n of nodes) {
    if (n.status === 'transposition') continue;
    if (n.status === 'gap') gaps.push(n.id);
    if (n.toMove === 'opp' && n.status !== 'end' && n.needsData) pending.push(n.id);
    if (n.toMove === 'opp' && n.status !== 'end' && n.needsEngine) needsEngine.push(n.id);
  }
  const orphans = [...input.entries.keys()].filter((k) => !byPosKey.has(k));

  return { color: input.color, nodes, byPosKey, gaps, pending, needsEngine, orphans, truncated };
}

/**
 * Erreichwahrscheinlichkeit: Produkt der Gegner-Anteile auf dem Weg; bei mehreren Wegen Summe,
 * gedeckelt auf 1. Eigene Züge zählen 100 %. Unbekannte Anteile zählen 0.
 * Verarbeitung in BFS-Reihenfolge = topologische Ordnung (jede Kante erhöht die Halbzugzahl);
 * Kanten zu bereits verarbeiteten Stellungen (Zyklen) werden ignoriert.
 */
function computeReach(nodes: GNode[], byPosKey: Map<string, number>) {
  const reach = new Map<string, number>();
  reach.set(nodes[0].posKey, 1);
  for (const n of nodes) {
    if (n.status === 'transposition') continue;
    const r = Math.min(1, reach.get(n.posKey) ?? 0);
    n.reach = r;
    for (const cid of n.children) {
      const c = nodes[cid];
      const canon = byPosKey.get(c.posKey)!;
      if (canon <= n.id) continue; // Rückwärtskante
      const f = n.toMove === 'opp' ? c.share ?? 0 : 1;
      reach.set(c.posKey, (reach.get(c.posKey) ?? 0) + r * f);
    }
  }
  for (const n of nodes) {
    if (n.status === 'transposition') n.reach = nodes[n.transposeOf!].reach;
  }
}

/** Knoten-IDs von der Wurzel bis id (inklusive). */
export function pathIds(g: Graph, id: number): number[] {
  const out: number[] = [];
  for (let cur = id; cur >= 0; cur = g.nodes[cur].parent) out.push(cur);
  return out.reverse();
}

export function pathSans(g: Graph, id: number): string[] {
  return pathIds(g, id)
    .slice(1)
    .map((i) => g.nodes[i].san!);
}

export function pathUcis(g: Graph, id: number): string[] {
  return pathIds(g, id)
    .slice(1)
    .map((i) => g.nodes[i].uci!);
}

/** Kanonischer Knoten (erste Fundstelle) für eine Stellung, löst Verweisknoten auf. */
export function canonicalId(g: Graph, posKey: string): number | undefined {
  return g.byPosKey.get(posKey);
}

export interface GapInfo {
  id: number;
  posKey: string;
  fen: string;
  ply: number;
  sans: string[];
  reach: number;
  family: string;
  /** Grober Ast (Familie nach der ersten Antwort, z. B. „Offene Spiele“) – für die Lückentour. */
  branch: string;
  name?: string;
  viaTrap: boolean;
}

export type GapSort = 'depth' | 'reach' | 'name';

export function gapList(g: Graph, sort: GapSort = 'depth'): GapInfo[] {
  const list = g.gaps.map((id) => {
    const n = g.nodes[id];
    return {
      id,
      posKey: n.posKey,
      fen: n.fen,
      ply: n.ply,
      sans: pathSans(g, id),
      reach: n.reach,
      family: n.family,
      branch: n.topFamily,
      name: n.name,
      viaTrap: !!n.trap,
    };
  });
  const cmp: Record<GapSort, (a: GapInfo, b: GapInfo) => number> = {
    depth: (a, b) => a.ply - b.ply || b.reach - a.reach,
    reach: (a, b) => b.reach - a.reach || a.ply - b.ply,
    name: (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'de') || a.ply - b.ply,
  };
  return list.sort(cmp[sort]);
}

/** Lücken nach Familie gruppiert; Gruppen nach Anzahl absteigend. */
export function groupGaps(gaps: GapInfo[]): { family: string; gaps: GapInfo[] }[] {
  const m = new Map<string, GapInfo[]>();
  for (const gp of gaps) {
    const arr = m.get(gp.family) ?? [];
    arr.push(gp);
    m.set(gp.family, arr);
  }
  return [...m.entries()].map(([family, gs]) => ({ family, gaps: gs })).sort((a, b) => b.gaps.length - a.gaps.length);
}

/**
 * Eigene Stellungen (ich am Zug, beantwortet) in Linien-Reihenfolge: Tiefensuche,
 * Gegnerzüge nach Häufigkeit. Für „Neu lernen“.
 */
export function lineOrder(g: Graph): number[] {
  const out: number[] = [];
  const stack = [0];
  while (stack.length) {
    const id = stack.pop()!;
    const n = g.nodes[id];
    if (n.status === 'transposition') continue;
    if (n.toMove === 'me' && n.status === 'answered') out.push(id);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return out;
}

/** Alle kanonischen Nachfahren (inkl. id selbst). */
export function subtreeIds(g: Graph, id: number): number[] {
  const out: number[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const n = g.nodes[cur];
    out.push(cur);
    if (n.status === 'transposition') continue;
    for (const c of n.children) stack.push(c);
  }
  return out;
}

export interface GraphStats {
  answered: number;
  gaps: number;
  pending: number;
  ends: number;
  nodes: number;
}

export function graphStats(g: Graph): GraphStats {
  let answered = 0;
  let ends = 0;
  for (const n of g.nodes) {
    if (n.status === 'answered') answered++;
    if (n.status === 'end') ends++;
  }
  return { answered, gaps: g.gaps.length, pending: g.pending.length, ends, nodes: g.nodes.length };
}
