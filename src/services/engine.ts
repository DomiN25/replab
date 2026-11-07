// Stockfish-Wrapper (Hauptthread). Die Stockfish-Datei selbst läuft als Web Worker.
import { parseBestMove, parseInfo, type UciInfo } from '../core/uci';
import { posKeyOf, uciLineToSan } from '../core/chess';
import type { EngineData, EngineLine } from '../core/types';

export interface AnalyseOptions {
  depth: number;
  multipv: number;
}

interface Search {
  id: number;
  fen: string;
  opts: AnalyseOptions;
  onUpdate: (lines: EngineLine[], depth: number) => void;
  resolve: (d: EngineData | undefined) => void;
  infos: Map<number, UciInfo>;
  depth: number;
  cancelled: boolean;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency ?? 8) <= 4;
}

/** Am Handy höchstens Tiefe 14 (Pflichtenheft 8: Lite-Build, Tiefe automatisch 14). */
export function effectiveDepth(depth: number): number {
  return isMobileDevice() ? Math.min(depth, 14) : depth;
}

export class EngineService {
  private worker?: Worker;
  private ready?: Promise<void>;
  private readyResolve?: () => void;
  private current?: Search;
  private next?: Search;
  private seq = 0;
  private stopping = false;
  failed?: string;

  constructor(private url: string) {}

  private init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      try {
        this.worker = new Worker(this.url);
      } catch (e) {
        this.failed = String(e);
        reject(e);
        return;
      }
      this.worker.onerror = (e) => {
        this.failed = e.message || 'Engine-Fehler';
        reject(new Error(this.failed));
      };
      this.worker.onmessage = (ev: MessageEvent<string>) => this.onLine(String(ev.data));
      this.worker.postMessage('uci');
    });
    return this.ready;
  }

  private onLine(line: string) {
    if (line === 'uciok') {
      this.worker!.postMessage('isready');
      return;
    }
    if (line === 'readyok') {
      this.readyResolve?.();
      this.readyResolve = undefined;
      return;
    }
    const cur = this.current;
    if (!cur) return;
    if (line.startsWith('info')) {
      const info = parseInfo(line);
      if (!info || info.bound || cur.cancelled) return;
      cur.infos.set(info.multipv, info);
      if (info.depth > cur.depth) cur.depth = info.depth;
      // Update, wenn alle MultiPV-Linien dieser Tiefe da sind (oder Linie 1)
      if (info.multipv === Math.min(cur.opts.multipv, cur.infos.size) || info.multipv === 1) {
        cur.onUpdate(this.lines(cur), cur.depth);
      }
      return;
    }
    if (line.startsWith('bestmove')) {
      void parseBestMove(line);
      this.current = undefined;
      this.stopping = false;
      const lines = this.lines(cur);
      cur.resolve(
        lines.length ? { posKey: posKeyOf(cur.fen), depth: cur.depth, lines, analysedAt: Date.now() } : undefined,
      );
      if (this.next) {
        const n = this.next;
        this.next = undefined;
        this.start(n);
      }
    }
  }

  private lines(s: Search): EngineLine[] {
    return [...s.infos.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, i]) => {
        const sans = uciLineToSan(s.fen, i.pv, 12);
        return { uci: i.pv[0], san: sans[0] ?? i.pv[0], cp: i.cp, mate: i.mate, pv: i.pv.slice(0, sans.length) };
      })
      .filter((l) => !!l.uci);
  }

  private start(s: Search) {
    this.current = s;
    const w = this.worker!;
    w.postMessage(`setoption name MultiPV value ${s.opts.multipv}`);
    w.postMessage(`position fen ${s.fen}`);
    w.postMessage(`go depth ${s.opts.depth}`);
  }

  /**
   * Analysiert eine Stellung. Eine laufende Analyse wird abgebrochen (Weiterklicken).
   * done liefert das Endergebnis (bei Abbruch die bis dahin erreichte Tiefe).
   */
  analyse(fen: string, opts: AnalyseOptions, onUpdate: (lines: EngineLine[], depth: number) => void) {
    let resolve!: (d: EngineData | undefined) => void;
    const done = new Promise<EngineData | undefined>((r) => (resolve = r));
    const s: Search = { id: ++this.seq, fen, opts, onUpdate, resolve, infos: new Map(), depth: 0, cancelled: false };
    void this.init()
      .then(() => {
        if (s.cancelled) {
          resolve(undefined);
          return;
        }
        if (this.current) {
          if (this.next) this.next.resolve(undefined);
          this.next = s;
          if (!this.stopping) {
            this.stopping = true;
            this.current.cancelled = true;
            this.worker!.postMessage('stop');
          }
        } else this.start(s);
      })
      .catch(() => resolve(undefined));
    return {
      done,
      cancel: () => {
        s.cancelled = true;
        if (this.next === s) {
          this.next = undefined;
          resolve(undefined);
        } else if (this.current === s && !this.stopping) {
          this.stopping = true;
          this.worker?.postMessage('stop');
        }
      },
    };
  }

  terminate() {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
  }
}
