// Datenschicht für den Sync: Grabsteine, Snapshot, Anwenden, Migration (fake-indexeddb).
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { RepDB } from '../src/data/db';
import { Repo } from '../src/data/repo';
import { START_FEN } from '../src/core/chess';
import { mergeSnapshots } from '../src/core/sync';
import { fenAfter, keyAfter } from './helpers';

let n = 0;
const fresh = () => new Repo(new RepDB(`sync-${n++}`));

describe('Repo + Sync', () => {
  it('Löschen hinterlässt Grabsteine (Zug, Karte, Repertoire, Wiederholungen)', async () => {
    const repo = fresh();
    const r = await repo.createRepertoire('W', 'white');
    await repo.setMove(r.id, START_FEN, 'e2e4', 'e4');
    const [card] = await repo.getCards(r.id);
    await repo.saveReview(card, card.srs, { cardId: card.id, repertoireId: r.id, posKey: card.posKey, at: 1, rating: 3, correct: true, msToAnswer: 1, mode: 'due' });
    await repo.deleteMoves(r.id, [keyAfter([])]);
    let t = await repo.db.tombstones.toArray();
    expect(t.map((x) => x.table).sort()).toEqual(['cards', 'moves']);
    await repo.deleteRepertoire(r.id);
    t = await repo.db.tombstones.toArray();
    expect(t.some((x) => x.table === 'repertoires')).toBe(true);
    expect(t.some((x) => x.table === 'reviews')).toBe(true);
  });

  it('Wiederholungen bekommen eine uid', async () => {
    const repo = fresh();
    const r = await repo.createRepertoire('W', 'white');
    await repo.setMove(r.id, START_FEN, 'e2e4', 'e4');
    const [card] = await repo.getCards(r.id);
    await repo.saveReview(card, card.srs, { cardId: card.id, repertoireId: r.id, posKey: card.posKey, at: 1, rating: 3, correct: true, msToAnswer: 1, mode: 'due' });
    const [rv] = await repo.db.reviews.toArray();
    expect(rv.uid).toBeTruthy();
  });

  it('Zwei Geräte: PC → Drive → Handy, Änderung am Handy → zurück zum PC', async () => {
    const pc = fresh();
    const phone = fresh();
    const r = await pc.createRepertoire('W', 'white');
    await pc.setMove(r.id, START_FEN, 'e2e4', 'e4');
    await pc.setMove(r.id, fenAfter(['e4', 'e5']), 'g1f3', 'Nf3');

    // PC lädt hoch
    let drive = mergeSnapshots(await pc.exportSnapshot(), undefined, 1).merged;
    // Handy (leer) holt
    const m1 = mergeSnapshots(await phone.exportSnapshot(), drive, 2);
    await phone.applySyncOps(m1.local);
    expect((await phone.getMoves(r.id)).length).toBe(2);
    expect((await phone.getCards(r.id)).length).toBe(2);

    // Handy trainiert + löscht 2.Sf3
    const card = (await phone.getCards(r.id)).find((c) => c.posKey === keyAfter([]))!;
    await new Promise((res) => setTimeout(res, 5));
    await phone.saveReview(card, { ...card.srs, reps: 7 }, { cardId: card.id, repertoireId: r.id, posKey: card.posKey, at: Date.now(), rating: 4, correct: true, msToAnswer: 900, mode: 'due' });
    await phone.deleteMoves(r.id, [keyAfter(['e4', 'e5'])]);
    const m2 = mergeSnapshots(await phone.exportSnapshot(), drive, 3);
    expect(m2.remoteChanged).toBe(true);
    drive = m2.merged;

    // PC holt
    const m3 = mergeSnapshots(await pc.exportSnapshot(), drive, 4);
    await pc.applySyncOps(m3.local);
    const pcMoves = await pc.getMoves(r.id);
    expect(pcMoves.map((m) => m.san)).toEqual(['e4']);
    const pcCard = (await pc.getCards(r.id)).find((c) => c.posKey === keyAfter([]))!;
    expect(pcCard.srs.reps).toBe(7);
    expect((await pc.db.reviews.toArray()).length).toBe(1);
    // danach stabil
    const m4 = mergeSnapshots(await pc.exportSnapshot(), drive, 5);
    expect(m4.localChanged).toBe(false);
  });

  it('Token bleibt lokal: weder im Snapshot noch beim Anwenden überschrieben', async () => {
    const a = fresh();
    const b = fresh();
    const sa = await a.getSettings();
    await a.saveSettings({ ...sa, explorer: { ...sa.explorer, token: 'lip_geraetA' } });
    const sb = await b.getSettings();
    await b.saveSettings({ ...sb, explorer: { ...sb.explorer, token: 'lip_geraetB' } });
    const snapA = await a.exportSnapshot();
    expect(JSON.stringify(snapA)).not.toContain('lip_geraetA');
    await new Promise((res) => setTimeout(res, 5));
    const s2 = await a.getSettings();
    await a.saveSettings({ ...s2, srs: { ...s2.srs, newPerDay: 33 } });
    const m = mergeSnapshots(await b.exportSnapshot(), await a.exportSnapshot(), 9);
    await b.applySyncOps(m.local);
    const after = await b.getSettings();
    expect(after.srs.newPerDay).toBe(33);
    expect(after.explorer.token).toBe('lip_geraetB');
  });

  it('Migration v1 → v2: vorhandene Wiederholungen bekommen eine uid', async () => {
    const name = `mig-${n++}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      repertoires: 'id, color',
      moves: 'id, repertoireId, &[repertoireId+posKey], updatedAt',
      marks: '[repertoireId+posKey], repertoireId',
      explorer: 'key, sig, posKey, fetchedAt',
      engine: 'posKey',
      cards: 'id, repertoireId, &[repertoireId+posKey]',
      reviews: '++id, cardId, repertoireId, at',
      settings: 'id',
    });
    await v1.table('reviews').add({ cardId: 'c', repertoireId: 'r', posKey: 'p', at: 1, rating: 3, correct: true, msToAnswer: 1, mode: 'due' });
    v1.close();
    const v2 = new RepDB(name);
    const [rv] = await v2.reviews.toArray();
    expect(rv.uid).toBeTruthy();
    expect(await v2.tombstones.count()).toBe(0);
  });
});
