// IndexedDB über Dexie. Läuft im Hauptthread UND im Graph-Worker (gleiche Datenbank).
import Dexie, { type Table } from 'dexie';
import type { Tombstone } from '../core/sync';
import type {
  Card,
  EngineData,
  ExplorerData,
  PositionMark,
  Repertoire,
  RepertoireMove,
  ReviewLog,
  Settings,
  Study,
} from '../core/types';

export class RepDB extends Dexie {
  repertoires!: Table<Repertoire, string>;
  moves!: Table<RepertoireMove, string>;
  marks!: Table<PositionMark, [string, string]>;
  explorer!: Table<ExplorerData, string>;
  engine!: Table<EngineData, string>;
  cards!: Table<Card, string>;
  reviews!: Table<ReviewLog, number>;
  settings!: Table<Settings, string>;
  tombstones!: Table<Tombstone, string>;
  studies!: Table<Study, string>;

  constructor(name = 'replab') {
    super(name);
    this.version(1).stores({
      repertoires: 'id, color',
      // &[repertoireId+posKey] = eindeutig → höchstens ein eigener Zug pro Repertoire und Stellung
      moves: 'id, repertoireId, &[repertoireId+posKey], updatedAt',
      marks: '[repertoireId+posKey], repertoireId',
      explorer: 'key, sig, posKey, fetchedAt',
      engine: 'posKey',
      cards: 'id, repertoireId, &[repertoireId+posKey]',
      reviews: '++id, cardId, repertoireId, at',
      settings: 'id',
    });
    // v2: Sync – Grabsteine für Löschungen, geräteübergreifende uid für Wiederholungen
    this.version(2)
      .stores({
        reviews: '++id, cardId, repertoireId, at, uid',
        tombstones: 'key, table, deletedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('reviews')
          .toCollection()
          .modify((r: { uid?: string }) => {
            if (!r.uid) r.uid = newId();
          });
      });
    // v3: Studien-Reiter (nur lokal, nicht im Sync/Backup)
    this.version(3).stores({ studies: 'id, updatedAt' });
  }
}

export const db = new RepDB();

/** ID ohne crypto.randomUUID (das fehlt in unsicheren Kontexten, z. B. http://192.168.x.x im WLAN). */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
