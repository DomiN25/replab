// Sync-Ablauf: Drive-Datei laden → mit lokalem Stand zusammenführen → lokal anwenden → hochladen.
// Immer nur ein Sync gleichzeitig; Änderungen während eines Syncs lösen danach einen weiteren aus.
import { isSyncSnapshot, mergeSnapshots, type MergeResult } from '../core/sync';
import type { Repo } from '../data/repo';
import type { DriveStore } from './drive';

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  deleted: number;
  uploaded: boolean;
  localChanged: boolean;
}

export interface SyncEngineOptions {
  repo: Repo;
  /** Drive-Zugriff mit gültigem Token (wird pro Sync neu erzeugt). */
  drive: () => DriveStore;
  /** Wird nach dem lokalen Anwenden aufgerufen (UI neu laden). */
  onApplied?: (res: MergeResult) => Promise<void> | void;
  now?: () => number;
}

export class SyncEngine {
  private running?: Promise<SyncOutcome>;
  private again = false;
  /** true, solange Drive-Änderungen lokal angewendet werden (Änderungs-Hooks ignorieren das). */
  applying = false;

  constructor(private o: SyncEngineOptions) {}

  sync(): Promise<SyncOutcome> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running.then(async (r) => {
      if (this.again) {
        this.again = false;
        return this.sync();
      }
      return r;
    });
  }

  get busy() {
    return !!this.running;
  }

  private async run(): Promise<SyncOutcome> {
    const now = (this.o.now ?? Date.now)();
    const drive = this.o.drive();
    const file = await drive.find();
    let remote;
    if (file) {
      const data = await drive.download(file.id);
      if (!isSyncSnapshot(data)) throw new Error('Sync-Datei in Google Drive hat ein unbekanntes Format.');
      remote = data;
    }
    const local = await this.o.repo.exportSnapshot();
    const res = mergeSnapshots(local, remote, now);
    if (res.localChanged) {
      this.applying = true;
      try {
        await this.o.repo.applySyncOps(res.local);
      } finally {
        this.applying = false;
      }
      await this.o.onApplied?.(res);
    }
    let uploaded = false;
    if (res.remoteChanged || !file) {
      if (file) await drive.update(file.id, res.merged);
      else await drive.create(res.merged);
      uploaded = true;
    }
    return { ...res.stats, uploaded, localChanged: res.localChanged };
  }
}

/** Dexie-Hooks: meldet jede Änderung an synchronisierten Tabellen (nicht an Caches). */
export function watchChanges(
  db: { table(name: string): { hook(ev: 'creating' | 'updating' | 'deleting', fn: () => void): void } },
  onChange: () => void,
  isSuppressed: () => boolean,
) {
  const fire = () => {
    if (!isSuppressed()) setTimeout(onChange, 0);
  };
  for (const t of ['repertoires', 'moves', 'marks', 'cards', 'reviews', 'settings', 'tombstones', 'studies']) {
    const table = db.table(t);
    table.hook('creating', fire);
    table.hook('updating', fire);
    table.hook('deleting', fire);
  }
}
