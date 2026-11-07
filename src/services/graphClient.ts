// Hauptthread-Seite des Graph-Workers: letzte Anfrage gewinnt.
import type { Graph } from '../core/graph';

interface Reply {
  reqId: number;
  graph?: Omit<Graph, 'byPosKey'> & { byPosKey: [string, number][] };
  ms?: number;
  error?: string;
}

export class GraphClient {
  private worker: Worker;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: { graph: Graph; ms: number }) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../workers/graph.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Reply>) => {
      const { reqId, graph, ms, error } = ev.data;
      const w = this.waiting.get(reqId);
      this.waiting.delete(reqId);
      if (!w) return;
      if (error || !graph) w.reject(new Error(error ?? 'Graph-Fehler'));
      else w.resolve({ graph: { ...graph, byPosKey: new Map(graph.byPosKey) }, ms: ms ?? 0 });
    };
  }

  compute(repertoireId: string): Promise<{ graph: Graph; ms: number }> {
    const reqId = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(reqId, { resolve, reject });
      this.worker.postMessage({ reqId, repertoireId });
    });
  }

  /** true, wenn eine neuere Anfrage existiert (Ergebnis verwerfen). */
  isStale(reqSeq: number) {
    return reqSeq < this.seq;
  }
  get currentSeq() {
    return this.seq;
  }
}
