// Datenschicht mit fake-indexeddb: Unique-Constraint, Karten, Import, Backup.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { RepDB } from '../src/data/db';
import { Repo } from '../src/data/repo';
import { START_FEN } from '../src/core/chess';
import { planImport } from '../src/core/pgn';
import { fenAfter, keyAfter } from './helpers';

let repo: Repo;
let n = 0;
beforeEach(() => {
  repo = new Repo(new RepDB(`test-${n++}`));
});

describe('Repo', () => {
  it('erstes Repertoire pro Farbe ist Hauptrepertoire; setMain schaltet um', async () => {
    const a = await repo.createRepertoire('Weiß', 'white');
    const b = await repo.createRepertoire('Zweitwaffe', 'white');
    const c = await repo.createRepertoire('Schwarz', 'black');
    expect([a.isMain, b.isMain, c.isMain]).toEqual([true, false, true]);
    await repo.setMain(b.id);
    const all = await repo.listRepertoires();
    expect(all.find((r) => r.id === a.id)!.isMain).toBe(false);
    expect(all.find((r) => r.id === b.id)!.isMain).toBe(true);
    expect(all.find((r) => r.id === c.id)!.isMain).toBe(true);
  });

  it('ein Eintrag pro Repertoire und Stellung (DB-Constraint)', async () => {
    const r = await repo.createRepertoire('W', 'white');
    await repo.setMove(r.id, START_FEN, 'e2e4', 'e4');
    await repo.setMove(r.id, START_FEN, 'd2d4', 'd4'); // ändert statt doppelt anzulegen
    const moves = await repo.getMoves(r.id);
    expect(moves.length).toBe(1);
    expect(moves[0].san).toBe('d4');
    // direkter Doppel-Insert wird von IndexedDB abgelehnt
    await expect(repo.db.moves.add({ ...moves[0], id: 'other' })).rejects.toBeTruthy();
  });

  it('Festlegen erzeugt eine neue Karte; Ändern behält oder verwirft die Historie', async () => {
    const r = await repo.createRepertoire('W', 'white');
    await repo.setMove(r.id, START_FEN, 'e2e4', 'e4');
    let [card] = await repo.getCards(r.id);
    expect(card.srs.state).toBe(0);
    await repo.saveReview(card, { ...card.srs, state: 2, reps: 3 }, {
      cardId: card.id, repertoireId: r.id, posKey: card.posKey, at: Date.now(), rating: 3, correct: true, msToAnswer: 2000, mode: 'due',
    });
    await repo.setMove(r.id, START_FEN, 'd2d4', 'd4', { resetHistory: false });
    [card] = await repo.getCards(r.id);
    expect(card.uci).toBe('d2d4');
    expect(card.srs.reps).toBe(3);
    await repo.setMove(r.id, START_FEN, 'c2c4', 'c4', { resetHistory: true });
    [card] = await repo.getCards(r.id);
    expect(card.srs.reps).toBe(0);
  });

  it('Markierungen: ignorieren und hinzufügen schließen sich aus', async () => {
    const r = await repo.createRepertoire('W', 'white');
    const k = keyAfter(['e4']);
    await repo.toggleOppMove(r.id, k, 'e7e6', 'extra', true);
    let m = await repo.toggleOppMove(r.id, k, 'e7e6', 'ignore', true);
    expect(m.ignoredOppMoves).toEqual(['e7e6']);
    expect(m.extraOppMoves).toEqual([]);
    m = await repo.updateMark(r.id, k, { endOfLine: true });
    expect(m.endOfLine).toBe(true);
    expect(m.ignoredOppMoves).toEqual(['e7e6']);
  });

  it('Import anwenden + JSON-Backup-Rundreise ohne Token', async () => {
    const r = await repo.createRepertoire('W', 'white');
    const plan = planImport('1. e4 e5 2. Nf3 (2. Bc4) Nc6 3. Bb5 { Spanisch | Tiefe: tief } *', 'white', new Map());
    await repo.applyImport(r.id, plan, 'pgn');
    expect((await repo.getMoves(r.id)).length).toBe(3);
    expect((await repo.getCards(r.id)).length).toBe(3);
    const marks = await repo.getMarks(r.id);
    expect(marks.find((x) => x.posKey === keyAfter(['e4']))!.extraOppMoves).toEqual(['e7e5']);

    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, explorer: { ...s.explorer, token: 'lip_geheim' } });
    const backup = await repo.exportAll();
    expect(JSON.stringify(backup)).not.toContain('lip_geheim');

    const other = new Repo(new RepDB(`test-${n++}`));
    await other.importAll(JSON.parse(JSON.stringify(backup)));
    expect((await other.getMoves(r.id)).length).toBe(3);
    expect((await other.getCards(r.id)).length).toBe(3);
  });

  it('Repertoire löschen entfernt alle zugehörigen Daten', async () => {
    const r = await repo.createRepertoire('W', 'white');
    await repo.setMove(r.id, START_FEN, 'e2e4', 'e4');
    await repo.setMove(r.id, fenAfter(['e4', 'e5']), 'g1f3', 'Nf3');
    await repo.deleteRepertoire(r.id);
    expect(await repo.db.moves.count()).toBe(0);
    expect(await repo.db.cards.count()).toBe(0);
  });
});
