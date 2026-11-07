// Lichess Opening Explorer: Warteschlange (1 Anfrage gleichzeitig), 429 → ≥ 60 s Pause, Cache 30 Tage.
import { playUci, posKeyOf } from '../core/chess';
import type { ExplorerData } from '../core/types';

/** Rochade ggf. von e1h1 auf e1g1 normalisieren (einheitlich mit PGN/Engine). */
function normUci(fen: string, uci: string): string {
  try {
    return playUci(fen, uci).uci;
  } catch {
    return uci;
  }
}

export type ExplorerSource = 'lichess' | 'masters';

export interface ExplorerParams {
  source: ExplorerSource;
  speeds: string[];
  ratings: number[];
}

export const CACHE_MS = 30 * 86400_000;
export const BACKOFF_MS = 60_000;

export function explorerSig(p: ExplorerParams): string {
  return p.source === 'masters' ? 'masters' : `lichess|${[...p.speeds].sort().join(',')}|${[...p.ratings].sort((a, b) => a - b).join(',')}`;
}

export function explorerUrl(fen: string, p: ExplorerParams): string {
  const f = encodeURIComponent(fen);
  if (p.source === 'masters') return `https://explorer.lichess.org/masters?fen=${f}&moves=15&topGames=0`;
  return `https://explorer.lichess.org/lichess?variant=standard&speeds=${p.speeds.join(',')}&ratings=${p.ratings.join(',')}&fen=${f}&moves=15&topGames=0&recentGames=0`;
}

export class ExplorerAuthError extends Error {
  constructor() {
    super('Lichess verlangt einen Token (HTTP 401). Bitte in den Einstellungen eintragen.');
  }
}

export interface ExplorerCacheStore {
  get(key: string): Promise<ExplorerData | undefined>;
  put(d: ExplorerData): Promise<void>;
}

export interface ExplorerStatus {
  state: 'idle' | 'busy' | 'backoff' | 'auth' | 'error';
  queued: number;
  backoffUntil?: number;
  lastError?: string;
}

interface Job {
  key: string;
  fen: string;
  params: ExplorerParams;
  priority: number;
  resolve: (d: ExplorerData) => void;
  reject: (e: unknown) => void;
  promise: Promise<ExplorerData>;
}

interface RawMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}

export interface ExplorerServiceOptions {
  cache: ExplorerCacheStore;
  getToken: () => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Pause nach einer Anfrage, wenn als Nächstes eine dringende Anfrage (Priorität ≥ urgentPriority) wartet. */
  minIntervalMs?: number;
  /**
   * Pause vor Hintergrund-Anfragen (Lückenscan). Gemessen 08.11.2026: Lichess lässt ~25–30 Anfragen
   * am Stück zu, danach 429. Mit 2 s Abstand bleibt der Scan unter dem Limit.
   */
  backgroundIntervalMs?: number;
  urgentPriority?: number;
}

export class ExplorerService {
  private queue: Job[] = [];
  private inflight = new Map<string, Job>();
  private running = false;
  private listeners = new Set<(s: ExplorerStatus) => void>();
  status: ExplorerStatus = { state: 'idle', queued: 0 };
  private authFailed = false;

  constructor(private o: ExplorerServiceOptions) {}

  private get fetchFn() {
    return this.o.fetch ?? globalThis.fetch.bind(globalThis);
  }
  private now() {
    return (this.o.now ?? Date.now)();
  }
  private sleep(ms: number) {
    return (this.o.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t))))(ms);
  }

  subscribe(fn: (s: ExplorerStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(p: Partial<ExplorerStatus>) {
    this.status = { ...this.status, ...p, queued: this.queue.length };
    for (const l of this.listeners) l(this.status);
  }

  /** Nach Token-Änderung erneut versuchen. */
  resetAuth() {
    this.authFailed = false;
    this.setStatus({ state: 'idle', lastError: undefined });
  }

  /** Nur aus dem Cache (ohne Netz). */
  async cached(fen: string, params: ExplorerParams): Promise<ExplorerData | undefined> {
    const key = `${posKeyOf(fen)}|${explorerSig(params)}`;
    const c = await this.o.cache.get(key);
    return c && this.now() - c.fetchedAt < CACHE_MS ? c : undefined;
  }

  /** Daten zur Stellung: Cache (≤ 30 Tage) oder Warteschlange. priority: höher = früher. */
  async get(fen: string, params: ExplorerParams, opts: { priority?: number; force?: boolean } = {}): Promise<ExplorerData> {
    const sig = explorerSig(params);
    const key = `${posKeyOf(fen)}|${sig}`;
    if (!opts.force) {
      const c = await this.o.cache.get(key);
      if (c && this.now() - c.fetchedAt < CACHE_MS) return c;
    }
    if (this.authFailed && !this.o.getToken()) throw new ExplorerAuthError();
    const existing = this.inflight.get(key);
    if (existing) {
      // Priorität ggf. anheben
      if ((opts.priority ?? 0) > existing.priority) {
        existing.priority = opts.priority ?? 0;
        this.sortQueue();
      }
      return existing.promise;
    }
    let resolve!: (d: ExplorerData) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<ExplorerData>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job = { key, fen, params, priority: opts.priority ?? 0, resolve, reject, promise };
    this.inflight.set(key, job);
    this.queue.push(job);
    this.sortQueue();
    this.setStatus({});
    void this.pump();
    return promise;
  }

  /** Wartende Anfragen mit niedriger Priorität verwerfen (z. B. Lückenscan abbrechen). */
  cancelBelow(priority: number) {
    const keep: Job[] = [];
    for (const j of this.queue) {
      if (j.priority < priority) {
        this.inflight.delete(j.key);
        j.reject(new Error('abgebrochen'));
      } else keep.push(j);
    }
    this.queue = keep;
    this.setStatus({});
  }

  private sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        this.setStatus({ state: 'busy' });
        try {
          const data = await this.fetchJob(job);
          await this.o.cache.put(data);
          job.resolve(data);
        } catch (e) {
          job.reject(e);
          if (e instanceof ExplorerAuthError) {
            // Alle weiteren sofort ablehnen
            for (const j of this.queue) {
              this.inflight.delete(j.key);
              j.reject(e);
            }
            this.queue = [];
          }
        } finally {
          this.inflight.delete(job.key);
        }
        if (this.queue.length) await this.pace();
      }
    } finally {
      this.running = false;
      if (this.status.state === 'busy') this.setStatus({ state: 'idle' });
    }
  }

  /**
   * Abstand zwischen Anfragen: kurz, wenn eine dringende Anfrage wartet (aktuelle Stellung),
   * sonst backgroundIntervalMs – in kleinen Schritten, damit eine neue dringende Anfrage vordrängeln kann.
   */
  private async pace() {
    const urgent = this.o.urgentPriority ?? 10;
    const short = this.o.minIntervalMs ?? 0;
    const long = this.o.backgroundIntervalMs ?? short;
    const isUrgent = () => (this.queue[0]?.priority ?? 0) >= urgent;
    if (short) await this.sleep(short);
    let waited = short;
    while (waited < long && this.queue.length && !isUrgent()) {
      const step = Math.min(250, long - waited);
      await this.sleep(step);
      waited += step;
    }
  }

  private async fetchJob(job: Job): Promise<ExplorerData> {
    for (;;) {
      const token = this.o.getToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      let res: Response;
      try {
        res = await this.fetchFn(explorerUrl(job.fen, job.params), { headers });
      } catch (e) {
        this.setStatus({ state: 'error', lastError: 'Netzwerkfehler (offline?)' });
        throw e;
      }
      if (res.status === 429) {
        const until = this.now() + BACKOFF_MS;
        this.setStatus({ state: 'backoff', backoffUntil: until, lastError: 'Lichess-Limit erreicht (429) – 60 s Pause' });
        await this.sleep(BACKOFF_MS);
        continue;
      }
      if (res.status === 401) {
        this.authFailed = true;
        this.setStatus({ state: 'auth', lastError: new ExplorerAuthError().message });
        throw new ExplorerAuthError();
      }
      if (!res.ok) {
        this.setStatus({ state: 'error', lastError: `HTTP ${res.status}` });
        throw new Error(`Explorer HTTP ${res.status}`);
      }
      const j = (await res.json()) as { white: number; draws: number; black: number; moves: RawMove[]; opening?: { eco: string; name: string } | null };
      const posKey = posKeyOf(job.fen);
      return {
        key: job.key,
        sig: explorerSig(job.params),
        posKey,
        moves: (j.moves ?? []).map((m) => ({
          uci: normUci(job.fen, m.uci),
          san: m.san,
          white: m.white,
          draws: m.draws,
          black: m.black,
          averageRating: m.averageRating,
        })),
        total: (j.white ?? 0) + (j.draws ?? 0) + (j.black ?? 0),
        opening: j.opening ?? undefined,
        fetchedAt: this.now(),
      };
    }
  }
}
