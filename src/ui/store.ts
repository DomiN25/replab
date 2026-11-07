// Globaler UI-Zustand (Zustand) + Aktionen. Logik bleibt in core/, Persistenz in data/.
import { create } from 'zustand';
import { repo } from '../data/repo';
import { START_FEN, playUci, posKeyOf } from '../core/chess';
import { pathIds, type Graph } from '../core/graph';
import { ExplorerService, type ExplorerParams, type ExplorerStatus, ExplorerAuthError } from '../services/explorer';
import { EngineService } from '../services/engine';
import { GraphClient } from '../services/graphClient';
import type { Card, PositionMark, Repertoire, RepertoireMove, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';

export type View = 'home' | 'build' | 'gaps' | 'train' | 'settings';
export interface LineStep {
  fen: string;
  uci?: string;
  san?: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
}

export interface AppState {
  loaded: boolean;
  settings: Settings;
  repertoires: Repertoire[];
  repId?: string;
  moves: Map<string, RepertoireMove>;
  marks: Map<string, PositionMark>;
  cards: Map<string, Card>;
  graph?: Graph;
  graphMs?: number;
  graphError?: string;
  graphBusy: boolean;
  view: View;
  line: LineStep[];
  cursor: number;
  flipped: boolean;
  engineOn: boolean;
  explorerSource: 'lichess' | 'masters';
  explorerStatus: ExplorerStatus;
  scanQueued: number;
  toast?: Toast;
  galaxyMode: 'family' | 'knowledge';
  sideView: 'galaxy' | 'list';
}

export const useApp = create<AppState>(() => ({
  loaded: false,
  settings: structuredClone(DEFAULT_SETTINGS),
  repertoires: [],
  moves: new Map(),
  marks: new Map(),
  cards: new Map(),
  graphBusy: false,
  view: 'home',
  line: [{ fen: START_FEN }],
  cursor: 0,
  flipped: false,
  engineOn: true,
  explorerSource: 'lichess',
  explorerStatus: { state: 'idle', queued: 0 },
  scanQueued: 0,
  galaxyMode: 'family',
  sideView: 'galaxy',
}));

const get = useApp.getState;
const set = useApp.setState;

// ------------------------------------------------------------ Dienste (Singletons)

export function lichessToken(): string | undefined {
  const t = get().settings.explorer.token?.trim();
  return t || (typeof __DEV_LICHESS_TOKEN__ !== 'undefined' && __DEV_LICHESS_TOKEN__ ? __DEV_LICHESS_TOKEN__ : undefined);
}

export const explorer = new ExplorerService({
  cache: { get: (k) => repo.getExplorer(k), put: (d) => repo.putExplorer(d) },
  getToken: lichessToken,
  minIntervalMs: 250,
});
explorer.subscribe((s) => set({ explorerStatus: s }));

let engineSingleton: EngineService | undefined;
export function engine(): EngineService {
  engineSingleton ??= new EngineService(new URL('engine/stockfish-19-lite-single.js', document.baseURI).href);
  return engineSingleton;
}

let graphClient: GraphClient | undefined;

export function explorerParams(source: 'lichess' | 'masters' = 'lichess'): ExplorerParams {
  const s = get().settings.explorer;
  return { source, speeds: s.speeds, ratings: s.ratings };
}

// ------------------------------------------------------------ Hilfen

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastSeq;
  set({ toast: { id, text, kind } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: undefined });
  }, kind === 'err' ? 6000 : 3200);
}

export function currentRep(): Repertoire | undefined {
  const s = get();
  return s.repertoires.find((r) => r.id === s.repId);
}

export function currentFen(): string {
  const s = get();
  return s.line[s.cursor]?.fen ?? START_FEN;
}

// ------------------------------------------------------------ Laden

export async function init() {
  const [settings, repertoires] = await Promise.all([repo.getSettings(), repo.listRepertoires()]);
  let repId: string | undefined;
  try {
    repId = localStorage.getItem('replab.rep') ?? undefined;
  } catch {
    /* privat/blockiert */
  }
  if (!repertoires.some((r) => r.id === repId)) {
    repId = (repertoires.find((r) => r.color === 'white' && r.isMain) ?? repertoires[0])?.id;
  }
  set({ settings, repertoires, loaded: true, view: viewFromHash() });
  if (repId) await selectRepertoire(repId);
  window.addEventListener('hashchange', () => set({ view: viewFromHash() }));
}

function viewFromHash(): View {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return (['home', 'build', 'gaps', 'train', 'settings'] as View[]).includes(h as View) ? (h as View) : 'home';
}

export function setView(v: View) {
  if (viewFromHash() !== v) location.hash = `/${v}`;
  set({ view: v });
}

export async function reloadRepertoires() {
  const repertoires = await repo.listRepertoires();
  set({ repertoires });
  if (!repertoires.some((r) => r.id === get().repId)) {
    const next = repertoires.find((r) => r.isMain) ?? repertoires[0];
    if (next) await selectRepertoire(next.id);
    else set({ repId: undefined, graph: undefined, moves: new Map(), marks: new Map(), cards: new Map() });
  }
}

export async function selectRepertoire(id: string) {
  try {
    localStorage.setItem('replab.rep', id);
  } catch {
    /* egal */
  }
  const rep = get().repertoires.find((r) => r.id === id);
  set({ repId: id, graph: undefined, line: [{ fen: START_FEN }], cursor: 0, flipped: false });
  scanTried.clear();
  await loadRepData();
  void rep;
}

export async function loadRepData() {
  const id = get().repId;
  if (!id) return;
  const [moves, marks, cards] = await Promise.all([repo.getMoves(id), repo.getMarks(id), repo.getCards(id)]);
  set({
    moves: new Map(moves.map((m) => [m.posKey, m])),
    marks: new Map(marks.map((m) => [m.posKey, m])),
    cards: new Map(cards.map((c) => [c.posKey, c])),
  });
  requestGraph();
}

export async function reloadSettings() {
  set({ settings: await repo.getSettings() });
}

export async function saveSettings(s: Settings) {
  await repo.saveSettings(s);
  set({ settings: s });
  explorer.resetAuth();
  scanTried.clear();
  requestGraph();
}

// ------------------------------------------------------------ Graph

let graphTimer: ReturnType<typeof setTimeout> | undefined;
export function requestGraph(delay = 120) {
  if (graphTimer) clearTimeout(graphTimer);
  graphTimer = setTimeout(() => void computeGraph(), delay);
}

async function computeGraph() {
  const id = get().repId;
  if (!id) return;
  graphClient ??= new GraphClient();
  set({ graphBusy: true });
  const seq = graphClient.currentSeq + 1;
  try {
    const { graph, ms } = await graphClient.compute(id);
    if (graphClient.isStale(seq) || get().repId !== id) return;
    set({ graph, graphMs: ms, graphError: undefined, graphBusy: false });
    scanPending();
  } catch (e) {
    set({ graphError: String(e), graphBusy: false });
  }
}

// Fehlende Explorer-Daten für Gegnerstellungen im Repertoire nachladen (niedrige Priorität)
const scanTried = new Set<string>();
let scanRefresh: ReturnType<typeof setTimeout> | undefined;

function scanPending() {
  const g = get().graph;
  if (!g || !lichessToken()) return;
  const st = get().explorerStatus.state;
  if (st === 'auth') return;
  const todo = g.pending
    .map((id) => g.nodes[id])
    .filter((n) => !scanTried.has(n.posKey))
    .sort((a, b) => b.reach - a.reach || a.ply - b.ply)
    .slice(0, 40);
  set({ scanQueued: todo.length });
  for (const n of todo) {
    scanTried.add(n.posKey);
    explorer
      .get(n.fen, explorerParams(), { priority: 0 })
      .then(() => {
        if (scanRefresh) clearTimeout(scanRefresh);
        scanRefresh = setTimeout(() => requestGraph(0), 600);
      })
      .catch((e) => {
        if (e instanceof ExplorerAuthError) toast(e.message, 'err');
      })
      .finally(() => set({ scanQueued: Math.max(0, get().scanQueued - 1) }));
  }
}

// ------------------------------------------------------------ Navigation (Bauen)

export function setLine(line: LineStep[], cursor = line.length - 1) {
  set({ line, cursor: Math.max(0, Math.min(cursor, line.length - 1)) });
}

export function gotoCursor(i: number) {
  const { line } = get();
  set({ cursor: Math.max(0, Math.min(i, line.length - 1)) });
}

export function back() {
  gotoCursor(get().cursor - 1);
}
export function forward() {
  gotoCursor(get().cursor + 1);
}

/** Zug am Brett: folgt der vorhandenen Linie oder verzweigt. */
export function playMove(uci: string) {
  const { line, cursor } = get();
  const fen = line[cursor].fen;
  let p;
  try {
    p = playUci(fen, uci);
  } catch {
    return;
  }
  const next = line[cursor + 1];
  if (next && next.uci === p.uci) {
    set({ cursor: cursor + 1 });
    return;
  }
  set({ line: [...line.slice(0, cursor + 1), { fen: p.fen, uci: p.uci, san: p.san }], cursor: cursor + 1 });
}

/** Linie aus einer UCI-Folge ab Grundstellung. */
export function lineFromUcis(ucis: string[], rootFen = START_FEN): LineStep[] {
  const out: LineStep[] = [{ fen: rootFen }];
  for (const u of ucis) {
    const p = playUci(out[out.length - 1].fen, u);
    out.push({ fen: p.fen, uci: p.uci, san: p.san });
  }
  return out;
}

/** Brett auf einen Graph-Knoten setzen (Pfad ab Wurzel). */
export function gotoNode(id: number) {
  const g = get().graph;
  if (!g) return;
  const ids = pathIds(g, id);
  setLine(lineFromUcis(ids.slice(1).map((i) => g.nodes[i].uci!), g.nodes[0].fen));
}

/** Zu einer Stellung springen (über die kanonische Fundstelle im Graphen). */
export function gotoPosKey(posKey: string, fallbackFen?: string) {
  const g = get().graph;
  const id = g?.byPosKey.get(posKey);
  if (id !== undefined) gotoNode(id);
  else if (fallbackFen) setLine([{ fen: fallbackFen }]);
}

// ------------------------------------------------------------ Repertoire ändern

export async function setMyMove(fen: string, uci: string, san: string, resetHistory = false) {
  const id = get().repId;
  if (!id) return;
  await repo.setMove(id, fen, uci, san, { resetHistory });
  await loadRepData();
}

export async function deleteMyMoves(posKeys: string[]) {
  const id = get().repId;
  if (!id) return;
  await repo.deleteMoves(id, posKeys);
  await loadRepData();
}

export async function saveMoveMeta(moveId: string, patch: Partial<Pick<RepertoireMove, 'note' | 'links' | 'tags'>>) {
  await repo.updateMoveMeta(moveId, patch);
  await loadRepData();
}

export async function toggleOpp(posKey: string, uci: string, kind: 'ignore' | 'extra', on: boolean) {
  const id = get().repId;
  if (!id) return;
  await repo.toggleOppMove(id, posKey, uci, kind, on);
  await loadRepData();
}

export async function updateMark(posKey: string, patch: Partial<Omit<PositionMark, 'repertoireId' | 'posKey'>>) {
  const id = get().repId;
  if (!id) return;
  await repo.updateMark(id, posKey, patch);
  await loadRepData();
}

/** Ende-Marker umschalten. */
export async function setEndOfLine(posKey: string, on: boolean) {
  await updateMark(posKey, { endOfLine: on });
}

/** Stellungen unterhalb eines (geänderten) Zugs, die danach nicht mehr erreichbar sind. */
export function orphanedAfterChange(): string[] {
  return get().graph?.orphans ?? [];
}

export { posKeyOf };
