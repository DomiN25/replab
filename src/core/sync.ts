// Sync-Zusammenführung (pure Logik): lokaler Stand + Drive-Stand → gemeinsamer Stand.
//
// Regeln:
// - Jeder Datensatz hat einen natürlichen Schlüssel (Zug/Karte/Markierung: Repertoire + Stellung).
//   Dadurch fallen gleiche Stellungen auch dann zusammen, wenn zwei Geräte verschiedene IDs vergeben haben.
// - Konflikte: neuerer Zeitstempel gewinnt (updatedAt bzw. deletedAt bei Grabsteinen), pro Datensatz.
// - Löschungen werden als Grabstein (Tombstone) mitgeführt, sonst würde ein gelöschter Datensatz
//   vom anderen Gerät wieder auferstehen. Grabstein gewinnt bei Gleichstand (Löschen nach Bearbeiten).
// - Wiederholungen (ReviewLog) sind unveränderlich: Vereinigung über die geräteübergreifende uid.
// - Einstellungen: als Ganzes nach updatedAt; der Lichess-Token ist nie im Sync-Stand.
import type { Card, PositionMark, Repertoire, RepertoireMove, ReviewLog, Settings, Study } from './types';

export type SyncTable = 'repertoires' | 'moves' | 'marks' | 'cards' | 'reviews' | 'studies';
type RecordTable = Exclude<SyncTable, 'reviews'>;

export interface Tombstone {
  key: string; // `${table}:${nk}`
  table: SyncTable;
  nk: string; // natürlicher Schlüssel (bei reviews: uid)
  deletedAt: number;
}

export type SyncSettings = Omit<Settings, 'explorer'> & { explorer: Omit<Settings['explorer'], 'token'> };

export interface SyncSnapshot {
  app: 'RepLab';
  kind: 'sync';
  version: 1;
  savedAt: number;
  repertoires: Repertoire[];
  moves: RepertoireMove[];
  marks: PositionMark[];
  cards: Card[];
  reviews: ReviewLog[];
  /** Studien-Reiter (ab 11/2026; ältere Stände haben das Feld nicht) */
  studies?: Study[];
  settings?: SyncSettings;
  tombstones: Tombstone[];
}

interface RecordTypes {
  repertoires: Repertoire;
  moves: RepertoireMove;
  marks: PositionMark;
  cards: Card;
  studies: Study;
}

export const RECORD_TABLES: RecordTable[] = ['repertoires', 'moves', 'marks', 'cards', 'studies'];

export function naturalKey<T extends RecordTable>(table: T, r: RecordTypes[T]): string {
  if (table === 'repertoires' || table === 'studies') return (r as { id: string }).id;
  const x = r as { repertoireId: string; posKey: string };
  return `${x.repertoireId}|${x.posKey}`;
}

export const tombKey = (table: SyncTable, nk: string) => `${table}:${nk}`;

export function tombstone(table: SyncTable, nk: string, deletedAt: number): Tombstone {
  return { key: tombKey(table, nk), table, nk, deletedAt };
}

export function emptySnapshot(savedAt = 0): SyncSnapshot {
  return { app: 'RepLab', kind: 'sync', version: 1, savedAt, repertoires: [], moves: [], marks: [], cards: [], reviews: [], studies: [], tombstones: [] };
}

export function isSyncSnapshot(x: unknown): x is SyncSnapshot {
  const s = x as SyncSnapshot;
  return !!s && s.app === 'RepLab' && s.kind === 'sync' && s.version === 1 && Array.isArray(s.moves);
}

/** Was lokal geändert werden muss, damit der lokale Stand dem gemeinsamen entspricht. */
export interface LocalOps {
  put: { repertoires: Repertoire[]; moves: RepertoireMove[]; marks: PositionMark[]; cards: Card[]; studies: Study[] };
  del: { repertoires: string[]; moves: string[]; marks: string[]; cards: string[]; reviews: string[]; studies: string[] };
  reviews: ReviewLog[];
  settings?: SyncSettings;
  tombstones: Tombstone[];
}

export interface MergeResult {
  merged: SyncSnapshot;
  local: LocalOps;
  localChanged: boolean;
  remoteChanged: boolean;
  stats: { pulled: number; pushed: number; deleted: number };
}

const sameRecord = (a: { updatedAt: number; id?: string }, b: { updatedAt: number; id?: string }) =>
  a.updatedAt === b.updatedAt && (a.id ?? '') === (b.id ?? '');

export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot | undefined, now: number): MergeResult {
  const r = remote ?? emptySnapshot();
  const ops: LocalOps = {
    put: { repertoires: [], moves: [], marks: [], cards: [], studies: [] },
    del: { repertoires: [], moves: [], marks: [], cards: [], reviews: [], studies: [] },
    reviews: [],
    tombstones: [],
  };
  let remoteChanged = !remote;
  let pulled = 0;
  let pushed = 0;
  let deleted = 0;

  // Grabsteine vereinigen (je Schlüssel der jüngste)
  const localTombs = new Map(local.tombstones.map((t) => [t.key, t]));
  const remoteTombs = new Map(r.tombstones.map((t) => [t.key, t]));
  const tombs = new Map<string, Tombstone>();
  for (const t of [...local.tombstones, ...r.tombstones]) {
    const cur = tombs.get(t.key);
    if (!cur || t.deletedAt > cur.deletedAt) tombs.set(t.key, t);
  }
  for (const t of tombs.values()) {
    const l = localTombs.get(t.key);
    const rt = remoteTombs.get(t.key);
    if (!l || l.deletedAt < t.deletedAt) ops.tombstones.push(t);
    if (!rt || rt.deletedAt < t.deletedAt) remoteChanged = true;
  }

  const merged = emptySnapshot(now);
  merged.tombstones = [...tombs.values()];

  const mergeTable = <T extends RecordTable>(table: T) => {
    const L = new Map(((local[table] ?? []) as RecordTypes[T][]).map((x) => [naturalKey(table, x), x]));
    const R = new Map(((r[table] ?? []) as RecordTypes[T][]).map((x) => [naturalKey(table, x), x]));
    const out: RecordTypes[T][] = [];
    for (const nk of new Set([...L.keys(), ...R.keys()])) {
      const l = L.get(nk);
      const rr = R.get(nk);
      const t = tombs.get(tombKey(table, nk));
      const lt = l?.updatedAt ?? -1;
      const rt = rr?.updatedAt ?? -1;
      if (t && t.deletedAt >= Math.max(lt, rt)) {
        // gelöscht
        if (l) {
          (ops.del[table] as string[]).push(nk);
          deleted++;
        }
        if (rr) remoteChanged = true;
        continue;
      }
      if (rr && (!l || rt > lt || (rt === lt && !sameRecord(l, rr)))) {
        out.push(rr);
        if (!l || !sameRecord(l, rr)) {
          (ops.put[table] as RecordTypes[T][]).push(rr);
          pulled++;
        }
      } else if (l) {
        out.push(l);
        if (!rr || !sameRecord(l, rr)) {
          remoteChanged = true;
          pushed++;
        }
      }
    }
    (merged[table] as RecordTypes[T][]) = out;
  };
  for (const t of RECORD_TABLES) mergeTable(t);

  // Wiederholungen: Vereinigung über uid, abzüglich Grabsteine
  const LR = new Map(local.reviews.filter((x) => x.uid).map((x) => [x.uid!, x]));
  const RR = new Map(r.reviews.filter((x) => x.uid).map((x) => [x.uid!, x]));
  for (const uid of new Set([...LR.keys(), ...RR.keys()])) {
    const tomb = tombs.get(tombKey('reviews', uid));
    const l = LR.get(uid);
    const rr = RR.get(uid);
    if (tomb) {
      if (l) ops.del.reviews.push(uid);
      if (rr) remoteChanged = true;
      continue;
    }
    if (rr && !l) {
      const { id: _id, ...rest } = rr;
      void _id;
      ops.reviews.push(rest);
      pulled++;
    }
    if (l && !rr) {
      remoteChanged = true;
      pushed++;
    }
    const { id: _i, ...clean } = (l ?? rr)!;
    void _i;
    merged.reviews.push(clean);
  }

  // Einstellungen
  const ls = local.settings;
  const rs = r.settings;
  if (rs && (!ls || rs.updatedAt > ls.updatedAt)) {
    merged.settings = rs;
    ops.settings = rs;
    pulled++;
  } else {
    merged.settings = ls;
    if (ls && (!rs || ls.updatedAt > rs.updatedAt)) remoteChanged = true;
  }

  const localChanged =
    RECORD_TABLES.some((t) => ops.put[t].length || ops.del[t].length) ||
    ops.reviews.length > 0 ||
    ops.del.reviews.length > 0 ||
    !!ops.settings ||
    ops.tombstones.length > 0;

  return { merged, local: ops, localChanged, remoteChanged, stats: { pulled, pushed, deleted } };
}
