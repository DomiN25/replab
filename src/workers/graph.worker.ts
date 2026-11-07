/// <reference lib="webworker" />
// Graph-/Lückenberechnung im Web Worker. Liest selbst aus IndexedDB (Dexie läuft auch im Worker),
// der Hauptthread schickt nur die Repertoire-ID.
import { Repo } from '../data/repo';
import { buildGraph } from '../core/graph';
import { explorerSig } from '../services/explorer';

const repo = new Repo();
let eco: Record<string, string> | undefined;

export interface GraphRequest {
  reqId: number;
  repertoireId: string;
}

self.onmessage = async (ev: MessageEvent<GraphRequest>) => {
  const { reqId, repertoireId } = ev.data;
  try {
    if (!eco) eco = (await import('../data/openings.json')).default as Record<string, string>;
    const reps = await repo.listRepertoires();
    const rep = reps.find((r) => r.id === repertoireId);
    if (!rep) throw new Error('Repertoire nicht gefunden');
    const [moves, marks, settings, engine] = await Promise.all([
      repo.getMoves(repertoireId),
      repo.getMarks(repertoireId),
      repo.getSettings(),
      repo.allEngine(),
    ]);
    const sig = explorerSig({ source: 'lichess', speeds: settings.explorer.speeds, ratings: settings.explorer.ratings });
    const explorer = await repo.explorerBySig(sig);
    const t0 = performance.now();
    const g = buildGraph({
      color: rep.color,
      entries: new Map(moves.map((m) => [m.posKey, { uci: m.uci, san: m.san }])),
      marks: new Map(marks.map((m) => [m.posKey, m])),
      explorer: new Map(explorer.map((x) => [x.posKey, x])),
      engine: new Map(engine.map((x) => [x.posKey, x])),
      ecoName: (k) => eco![k],
      settings: {
        minShare: settings.explorer.minShare,
        minGames: settings.explorer.minGames,
        nearBestCp: settings.engine.nearBestCp,
        trapLossCp: settings.engine.trapLossCp,
        trapMinShare: settings.engine.trapMinShare,
      },
    });
    const ms = performance.now() - t0;
    (self as unknown as Worker).postMessage({ reqId, graph: { ...g, byPosKey: [...g.byPosKey] }, ms });
  } catch (e) {
    (self as unknown as Worker).postMessage({ reqId, error: String(e) });
  }
};
