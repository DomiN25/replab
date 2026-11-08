import { describe, it, expect } from 'vitest';
import { emptySnapshot, mergeSnapshots, tombstone, type SyncSnapshot } from '../src/core/sync';
import type { Card, RepertoireMove, ReviewLog } from '../src/core/types';
import { DEFAULT_SETTINGS } from '../src/core/types';

const REP = { id: 'r1', name: 'Weiß', color: 'white' as const, isMain: true, createdAt: 1, updatedAt: 1 };

function move(posKey: string, uci: string, updatedAt: number, id = `m-${posKey}-${updatedAt}`): RepertoireMove {
  return { id, repertoireId: 'r1', posKey, fen: posKey + ' 0 1', uci, san: uci, source: 'manual', createdAt: 1, updatedAt };
}

function card(posKey: string, reps: number, updatedAt: number, id = `c-${posKey}`): Card {
  return {
    id,
    repertoireId: 'r1',
    posKey,
    uci: 'e2e4',
    srs: { due: 0, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps, lapses: 0, state: 2 },
    createdAt: 1,
    updatedAt,
  };
}

function review(uid: string, at: number): ReviewLog {
  return { uid, cardId: 'c', repertoireId: 'r1', posKey: 'p', at, rating: 3, correct: true, msToAnswer: 1000, mode: 'due' };
}

function snap(p: Partial<SyncSnapshot>): SyncSnapshot {
  return { ...emptySnapshot(0), repertoires: [REP], ...p };
}

describe('Sync-Zusammenführung', () => {
  it('erster Sync ohne Drive-Datei: alles hochladen, lokal nichts ändern', () => {
    const local = snap({ moves: [move('A', 'e2e4', 10)] });
    const res = mergeSnapshots(local, undefined, 100);
    expect(res.remoteChanged).toBe(true);
    expect(res.localChanged).toBe(false);
    expect(res.merged.moves.length).toBe(1);
  });

  it('neues Gerät (leer): alles vom Drive übernehmen, nichts hochladen', () => {
    const remote = snap({ moves: [move('A', 'e2e4', 10)], cards: [card('A', 2, 10)], reviews: [review('u1', 5)] });
    const res = mergeSnapshots(emptySnapshot(0), remote, 100);
    expect(res.local.put.repertoires.length).toBe(1);
    expect(res.local.put.moves.map((m) => m.posKey)).toEqual(['A']);
    expect(res.local.reviews.map((r) => r.uid)).toEqual(['u1']);
    expect(res.remoteChanged).toBe(false);
  });

  it('Konflikt: neuerer Zeitstempel gewinnt – pro Datensatz', () => {
    const local = snap({ moves: [move('A', 'e2e4', 20), move('B', 'd2d4', 5)] });
    const remote = snap({ moves: [move('A', 'c2c4', 10), move('B', 'g1f3', 30)] });
    const res = mergeSnapshots(local, remote, 100);
    const byPos = new Map(res.merged.moves.map((m) => [m.posKey, m.uci]));
    expect(byPos.get('A')).toBe('e2e4'); // lokal neuer
    expect(byPos.get('B')).toBe('g1f3'); // Drive neuer
    expect(res.local.put.moves.map((m) => m.posKey)).toEqual(['B']);
    expect(res.remoteChanged).toBe(true); // A muss hoch
  });

  it('gleiche Stellung mit verschiedenen IDs fällt zusammen (natürlicher Schlüssel)', () => {
    const local = snap({ moves: [move('A', 'e2e4', 10, 'id-pc')] });
    const remote = snap({ moves: [move('A', 'e2e4', 12, 'id-handy')] });
    const res = mergeSnapshots(local, remote, 100);
    expect(res.merged.moves.length).toBe(1);
    expect(res.merged.moves[0].id).toBe('id-handy');
    expect(res.local.put.moves[0].id).toBe('id-handy');
  });

  it('identische Stände: nichts zu tun', () => {
    const s = snap({ moves: [move('A', 'e2e4', 10)], cards: [card('A', 1, 10)], reviews: [review('u1', 1)] });
    const res = mergeSnapshots(s, structuredClone(s), 100);
    expect(res.localChanged).toBe(false);
    expect(res.remoteChanged).toBe(false);
  });

  it('Löschen auf einem Gerät wird übernommen (Grabstein jünger als Datensatz)', () => {
    const local = snap({ moves: [move('A', 'e2e4', 10)], cards: [card('A', 1, 10)] });
    const remote = snap({ tombstones: [tombstone('moves', 'r1|A', 15), tombstone('cards', 'r1|A', 15)] });
    const res = mergeSnapshots(local, remote, 100);
    expect(res.local.del.moves).toEqual(['r1|A']);
    expect(res.local.del.cards).toEqual(['r1|A']);
    expect(res.merged.moves).toEqual([]);
    expect(res.local.tombstones.length).toBe(2);
  });

  it('gelöschter Datensatz kehrt nicht vom anderen Gerät zurück', () => {
    // Lokal gelöscht (Grabstein 15), Drive hat noch die alte Version (10)
    const local = snap({ tombstones: [tombstone('moves', 'r1|A', 15)] });
    const remote = snap({ moves: [move('A', 'e2e4', 10)] });
    const res = mergeSnapshots(local, remote, 100);
    expect(res.local.put.moves).toEqual([]);
    expect(res.merged.moves).toEqual([]);
    expect(res.remoteChanged).toBe(true);
  });

  it('nach dem Löschen neu festgelegt: neuer Datensatz schlägt alten Grabstein', () => {
    const local = snap({ moves: [move('A', 'd2d4', 30)] });
    const remote = snap({ tombstones: [tombstone('moves', 'r1|A', 15)] });
    const res = mergeSnapshots(local, remote, 100);
    expect(res.merged.moves.map((m) => m.uci)).toEqual(['d2d4']);
    expect(res.local.del.moves).toEqual([]);
  });

  it('Wiederholungen beider Geräte werden vereinigt (nichts geht verloren)', () => {
    const local = snap({ reviews: [review('pc1', 1), review('both', 2)] });
    const remote = snap({ reviews: [review('handy1', 3), review('both', 2)] });
    const res = mergeSnapshots(local, remote, 100);
    expect(res.merged.reviews.map((r) => r.uid).sort()).toEqual(['both', 'handy1', 'pc1']);
    expect(res.local.reviews.map((r) => r.uid)).toEqual(['handy1']);
    expect(res.remoteChanged).toBe(true);
  });

  it('Karte: Lernstand mit neuerem Zeitstempel gewinnt (Training am Handy, später am PC sichtbar)', () => {
    const local = snap({ cards: [card('A', 1, 10)] });
    const remote = snap({ cards: [card('A', 4, 50)] });
    const res = mergeSnapshots(local, remote, 100);
    expect(res.local.put.cards[0].srs.reps).toBe(4);
  });

  it('Einstellungen: neuere gewinnen; Token ist nie Teil des Stands', () => {
    const { token: _t, ...ex } = DEFAULT_SETTINGS.explorer;
    void _t;
    const older = { ...DEFAULT_SETTINGS, explorer: ex, updatedAt: 10 };
    const newer = { ...older, srs: { ...older.srs, newPerDay: 25 }, updatedAt: 20 };
    const res = mergeSnapshots(snap({ settings: older }), snap({ settings: newer }), 100);
    expect(res.local.settings?.srs.newPerDay).toBe(25);
    expect(JSON.stringify(res.merged)).not.toContain('token');
    const res2 = mergeSnapshots(snap({ settings: newer }), snap({ settings: older }), 100);
    expect(res2.local.settings).toBeUndefined();
    expect(res2.remoteChanged).toBe(true);
  });

  it('Zusammenführung ist stabil: zweiter Durchlauf ändert nichts mehr', () => {
    const local = snap({ moves: [move('A', 'e2e4', 20)], reviews: [review('a', 1)], tombstones: [tombstone('moves', 'r1|X', 5)] });
    const remote = snap({ moves: [move('B', 'd2d4', 30)], reviews: [review('b', 2)] });
    const first = mergeSnapshots(local, remote, 100);
    // Gerät wendet lokale Änderungen an und lädt merged hoch → danach sind beide gleich
    const second = mergeSnapshots(first.merged, first.merged, 200);
    expect(second.localChanged).toBe(false);
    expect(second.remoteChanged).toBe(false);
  });
});
