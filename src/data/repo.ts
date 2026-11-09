// Repository-Funktionen: alle Schreibzugriffe setzen updatedAt (für späteren Sync).
import { db as defaultDb, newId, type RepDB } from './db';
import { posKeyOf } from '../core/chess';
import { newSrs } from '../core/srs';
import type { ImportPlan } from '../core/pgn';
import { naturalKey, tombstone, type LocalOps, type SyncSnapshot, type SyncTable } from '../core/sync';
import {
  DEFAULT_SETTINGS,
  type Card,
  type Color,
  type EngineData,
  type ExplorerData,
  type PositionMark,
  type Repertoire,
  type RepertoireMove,
  type ReviewLog,
  type Settings,
  type SrsState,
  type Study,
} from '../core/types';

export class Repo {
  constructor(public db: RepDB = defaultDb) {}

  // ------------------------------------------------------------ Einstellungen
  async getSettings(): Promise<Settings> {
    const s = await this.db.settings.get('settings');
    if (!s) return structuredClone(DEFAULT_SETTINGS);
    // Neue Felder aus Updates ergänzen
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      explorer: { ...DEFAULT_SETTINGS.explorer, ...s.explorer },
      engine: { ...DEFAULT_SETTINGS.engine, ...s.engine },
      srs: { ...DEFAULT_SETTINGS.srs, ...s.srs },
      ui: { ...DEFAULT_SETTINGS.ui, ...s.ui },
    };
  }

  async saveSettings(s: Settings): Promise<void> {
    await this.db.settings.put({ ...s, id: 'settings', updatedAt: Date.now() });
  }

  // ------------------------------------------------------------ Grabsteine (Sync)
  /** Löschungen merken, damit sie beim Sync nicht vom anderen Gerät zurückkommen. */
  private async tomb(table: SyncTable, nks: string[], at = Date.now()) {
    if (nks.length) await this.db.tombstones.bulkPut(nks.map((nk) => tombstone(table, nk, at)));
  }

  // ------------------------------------------------------------ Repertoires
  listRepertoires(): Promise<Repertoire[]> {
    return this.db.repertoires.toArray();
  }

  async createRepertoire(name: string, color: Color): Promise<Repertoire> {
    const now = Date.now();
    const hasMain = (await this.db.repertoires.where('color').equals(color).toArray()).some((r) => r.isMain);
    const r: Repertoire = { id: newId(), name, color, isMain: !hasMain, createdAt: now, updatedAt: now };
    await this.db.repertoires.add(r);
    return r;
  }

  async renameRepertoire(id: string, name: string): Promise<void> {
    await this.db.repertoires.update(id, { name, updatedAt: Date.now() });
  }

  /** Genau ein Hauptrepertoire pro Farbe. */
  async setMain(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.repertoires, async () => {
      const r = await this.db.repertoires.get(id);
      if (!r) return;
      const now = Date.now();
      const same = await this.db.repertoires.where('color').equals(r.color).toArray();
      for (const x of same) await this.db.repertoires.update(x.id, { isMain: x.id === id, updatedAt: now });
    });
  }

  /** Löscht Repertoire inkl. Einträgen, Markierungen, Karten und Historie. */
  async deleteRepertoire(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.repertoires, this.db.moves, this.db.marks, this.db.cards, this.db.reviews, this.db.tombstones], async () => {
      const r = await this.db.repertoires.get(id);
      await this.clearRepertoireTx(id);
      await this.db.repertoires.delete(id);
      await this.tomb('repertoires', [id]);
      if (r?.isMain) {
        const next = (await this.db.repertoires.where('color').equals(r.color).toArray())[0];
        if (next) await this.db.repertoires.update(next.id, { isMain: true, updatedAt: Date.now() });
      }
    });
  }

  /** Leert ein Repertoire (für „alles neu festlegen“). */
  async clearRepertoire(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.moves, this.db.marks, this.db.cards, this.db.reviews, this.db.tombstones], () => this.clearRepertoireTx(id));
  }

  private async clearRepertoireTx(id: string) {
    const [moves, marks, cards, reviews] = await Promise.all([
      this.db.moves.where('repertoireId').equals(id).toArray(),
      this.db.marks.where('repertoireId').equals(id).toArray(),
      this.db.cards.where('repertoireId').equals(id).toArray(),
      this.db.reviews.where('repertoireId').equals(id).toArray(),
    ]);
    await this.tomb('moves', moves.map((m) => naturalKey('moves', m)));
    await this.tomb('marks', marks.map((m) => naturalKey('marks', m)));
    await this.tomb('cards', cards.map((c) => naturalKey('cards', c)));
    await this.tomb('reviews', reviews.filter((x) => x.uid).map((x) => x.uid!));
    await this.db.moves.where('repertoireId').equals(id).delete();
    await this.db.marks.where('repertoireId').equals(id).delete();
    await this.db.cards.where('repertoireId').equals(id).delete();
    await this.db.reviews.where('repertoireId').equals(id).delete();
  }

  // ------------------------------------------------------------ Einträge
  getMoves(repId: string): Promise<RepertoireMove[]> {
    return this.db.moves.where('repertoireId').equals(repId).toArray();
  }

  getMove(repId: string, posKey: string): Promise<RepertoireMove | undefined> {
    return this.db.moves.where('[repertoireId+posKey]').equals([repId, posKey]).first();
  }

  /**
   * Legt den eigenen Zug in einer Stellung fest (oder ändert ihn).
   * resetHistory: beim Ändern die Lernhistorie verwerfen (nur nach Rückfrage in der UI).
   */
  async setMove(
    repId: string,
    fen: string,
    uci: string,
    san: string,
    opts: { source?: RepertoireMove['source']; resetHistory?: boolean; note?: string; tags?: string[] } = {},
  ): Promise<RepertoireMove> {
    const posKey = posKeyOf(fen);
    const now = Date.now();
    return this.db.transaction('rw', [this.db.moves, this.db.cards], async () => {
      const existing = await this.getMove(repId, posKey);
      let move: RepertoireMove;
      if (existing) {
        move = { ...existing, uci, san, updatedAt: now };
        if (opts.note !== undefined) move.note = opts.note;
        if (opts.tags !== undefined) move.tags = opts.tags;
        await this.db.moves.put(move);
      } else {
        move = {
          id: newId(),
          repertoireId: repId,
          posKey,
          fen,
          uci,
          san,
          note: opts.note,
          tags: opts.tags,
          source: opts.source ?? 'manual',
          createdAt: now,
          updatedAt: now,
        };
        await this.db.moves.add(move);
      }
      const card = await this.db.cards.where('[repertoireId+posKey]').equals([repId, posKey]).first();
      if (!card) {
        await this.db.cards.add({ id: newId(), repertoireId: repId, posKey, uci, srs: newSrs(now), createdAt: now, updatedAt: now });
      } else if (card.uci !== uci) {
        await this.db.cards.put({ ...card, uci, srs: opts.resetHistory ? newSrs(now) : card.srs, updatedAt: now });
      }
      return move;
    });
  }

  async updateMoveMeta(id: string, patch: Partial<Pick<RepertoireMove, 'note' | 'links' | 'tags'>>): Promise<void> {
    await this.db.moves.update(id, { ...patch, updatedAt: Date.now() });
  }

  async deleteMoves(repId: string, posKeys: string[]): Promise<void> {
    await this.db.transaction('rw', [this.db.moves, this.db.cards, this.db.tombstones], async () => {
      for (const k of posKeys) {
        await this.db.moves.where('[repertoireId+posKey]').equals([repId, k]).delete();
        await this.db.cards.where('[repertoireId+posKey]').equals([repId, k]).delete();
      }
      const nks = posKeys.map((k) => repId + '|' + k);
      await this.tomb('moves', nks);
      await this.tomb('cards', nks);
    });
  }

  // ------------------------------------------------------------ Markierungen
  getMarks(repId: string): Promise<PositionMark[]> {
    return this.db.marks.where('repertoireId').equals(repId).toArray();
  }

  async updateMark(repId: string, posKey: string, patch: Partial<Omit<PositionMark, 'repertoireId' | 'posKey'>>): Promise<PositionMark> {
    return this.db.transaction('rw', this.db.marks, async () => {
      const cur = (await this.db.marks.get([repId, posKey])) ?? { repertoireId: repId, posKey, updatedAt: 0 };
      const next: PositionMark = { ...cur, ...patch, repertoireId: repId, posKey, updatedAt: Date.now() };
      await this.db.marks.put(next);
      return next;
    });
  }

  async toggleOppMove(repId: string, posKey: string, uci: string, kind: 'ignore' | 'extra', on: boolean) {
    const cur = await this.db.marks.get([repId, posKey]);
    const field = kind === 'ignore' ? 'ignoredOppMoves' : 'extraOppMoves';
    const other = kind === 'ignore' ? 'extraOppMoves' : 'ignoredOppMoves';
    const set = new Set(cur?.[field] ?? []);
    const otherSet = new Set(cur?.[other] ?? []);
    if (on) {
      set.add(uci);
      otherSet.delete(uci);
    } else set.delete(uci);
    return this.updateMark(repId, posKey, { [field]: [...set], [other]: [...otherSet] });
  }

  // ------------------------------------------------------------ Caches
  getExplorer(key: string): Promise<ExplorerData | undefined> {
    return this.db.explorer.get(key);
  }

  async putExplorer(d: ExplorerData): Promise<void> {
    await this.db.explorer.put(d);
  }

  explorerBySig(sig: string): Promise<ExplorerData[]> {
    return this.db.explorer.where('sig').equals(sig).toArray();
  }

  getEngine(posKey: string): Promise<EngineData | undefined> {
    return this.db.engine.get(posKey);
  }

  /** Engine-Cache: tiefere Analyse gewinnt. */
  async putEngine(d: EngineData): Promise<void> {
    const cur = await this.db.engine.get(d.posKey);
    if (!cur || cur.depth <= d.depth) await this.db.engine.put(d);
  }

  allEngine(): Promise<EngineData[]> {
    return this.db.engine.toArray();
  }

  // ------------------------------------------------------------ Karten & Historie
  getCards(repId: string): Promise<Card[]> {
    return this.db.cards.where('repertoireId').equals(repId).toArray();
  }

  /** Speichert Lernstand + Wiederholung; liefert die uid der Wiederholung (für „Verklicker“-Rücknahme). */
  async saveReview(card: Card, srs: SrsState, log: Omit<ReviewLog, 'id'>): Promise<string> {
    const uid = log.uid ?? newId();
    await this.db.transaction('rw', [this.db.cards, this.db.reviews], async () => {
      await this.db.cards.put({ ...card, srs, updatedAt: Date.now() });
      await this.db.reviews.add({ ...log, uid } as ReviewLog);
    });
    return uid;
  }

  /** Bewertung zurücknehmen: Lernstand der Karte zurücksetzen, Wiederholung löschen (Grabstein für den Sync). */
  async undoReview(card: Card, prevSrs: SrsState, uid: string): Promise<void> {
    await this.db.transaction('rw', [this.db.cards, this.db.reviews, this.db.tombstones], async () => {
      await this.db.cards.put({ ...card, srs: prevSrs, updatedAt: Date.now() });
      await this.db.reviews.where('uid').equals(uid).delete();
      await this.tomb('reviews', [uid]);
    });
  }

  reviewsSince(ts: number): Promise<ReviewLog[]> {
    return this.db.reviews.where('at').aboveOrEqual(ts).toArray();
  }

  // ------------------------------------------------------------ Import
  async applyImport(repId: string, plan: ImportPlan, source: RepertoireMove['source']): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', [this.db.moves, this.db.cards, this.db.marks], async () => {
      for (const e of plan.entries) {
        if (e.status === 'unchanged') continue;
        const existing = await this.getMove(repId, e.posKey);
        if (existing) {
          await this.db.moves.put({ ...existing, uci: e.uci, san: e.san, note: e.note, tags: e.tags, updatedAt: now });
        } else {
          await this.db.moves.add({
            id: newId(),
            repertoireId: repId,
            posKey: e.posKey,
            fen: e.fen,
            uci: e.uci,
            san: e.san,
            note: e.note,
            tags: e.tags.length ? e.tags : undefined,
            source,
            createdAt: now,
            updatedAt: now,
          });
        }
        const card = await this.db.cards.where('[repertoireId+posKey]').equals([repId, e.posKey]).first();
        if (!card) {
          await this.db.cards.add({ id: newId(), repertoireId: repId, posKey: e.posKey, uci: e.uci, srs: newSrs(now), createdAt: now, updatedAt: now });
        } else if (card.uci !== e.uci) {
          // Konflikt bewusst zugunsten des neuen Zugs entschieden → Lernhistorie gilt nicht mehr
          await this.db.cards.put({ ...card, uci: e.uci, srs: newSrs(now), updatedAt: now });
        }
      }
      for (const m of plan.marks) {
        const cur = await this.db.marks.get([repId, m.posKey]);
        const extra = new Set([...(cur?.extraOppMoves ?? []), ...m.extraOppMoves]);
        const note = cur?.note && m.note && !cur.note.includes(m.note) ? `${cur.note}\n\n${m.note}` : cur?.note ?? m.note;
        await this.db.marks.put({
          ...(cur ?? { repertoireId: repId, posKey: m.posKey }),
          extraOppMoves: [...extra],
          label: cur?.label ?? m.label,
          note,
          updatedAt: now,
        } as PositionMark);
      }
    });
  }

  // ------------------------------------------------------------ JSON-Backup
  /** Vollständiges Backup ohne Token und ohne Caches. */
  // ------------------------------------------------------------ Studien (lokal)
  async listStudies(): Promise<Study[]> {
    return (await this.db.studies.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getStudy(id: string): Promise<Study | undefined> {
    return this.db.studies.get(id);
  }

  async createStudy(data: Pick<Study, 'name' | 'color' | 'pgn' | 'source'>): Promise<Study> {
    const now = Date.now();
    const st: Study = { id: newId(), choices: {}, cuts: [], skipChapters: [], createdAt: now, updatedAt: now, ...data };
    await this.db.studies.add(st);
    return st;
  }

  async saveStudy(st: Study): Promise<void> {
    await this.db.studies.put({ ...st, updatedAt: Date.now() });
  }

  async deleteStudy(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.studies, this.db.tombstones], async () => {
      await this.db.studies.delete(id);
      await this.tomb('studies', [id]); // sonst kehrt sie per Sync vom anderen Gerät zurück
    });
  }

  async exportAll(): Promise<BackupFile> {
    const settings = await this.getSettings();
    const { token: _t, ...explorer } = settings.explorer;
    void _t;
    return {
      app: 'RepLab',
      version: 1,
      exportedAt: Date.now(),
      repertoires: await this.db.repertoires.toArray(),
      moves: await this.db.moves.toArray(),
      marks: await this.db.marks.toArray(),
      cards: await this.db.cards.toArray(),
      reviews: await this.db.reviews.toArray(),
      studies: await this.db.studies.toArray(),
      settings: { ...settings, explorer },
    };
  }

  // ------------------------------------------------------------ Sync
  /** Lokaler Stand für den Sync (ohne Token, ohne Caches). */
  async exportSnapshot(): Promise<SyncSnapshot> {
    const s = await this.db.settings.get('settings');
    let settings: SyncSnapshot['settings'];
    if (s) {
      const { token: _t, ...explorer } = s.explorer;
      void _t;
      settings = { ...s, explorer };
    }
    return {
      app: 'RepLab',
      kind: 'sync',
      version: 1,
      savedAt: Date.now(),
      repertoires: await this.db.repertoires.toArray(),
      moves: await this.db.moves.toArray(),
      marks: await this.db.marks.toArray(),
      cards: await this.db.cards.toArray(),
      reviews: (await this.db.reviews.toArray()).map(({ id: _id, ...r }) => r as ReviewLog),
      studies: await this.db.studies.toArray(),
      settings,
      tombstones: await this.db.tombstones.toArray(),
    };
  }

  /** Änderungen aus dem Sync lokal anwenden (eine Transaktion). Token bleibt lokal. */
  async applySyncOps(ops: LocalOps): Promise<void> {
    const t = this.db;
    await t.transaction('rw', [t.repertoires, t.moves, t.marks, t.cards, t.reviews, t.settings, t.tombstones, t.studies], async () => {
      const splitNk = (nk: string) => {
        const i = nk.indexOf('|');
        return [nk.slice(0, i), nk.slice(i + 1)] as [string, string];
      };
      for (const id of ops.del.repertoires) await t.repertoires.delete(id);
      for (const nk of ops.del.moves) await t.moves.where('[repertoireId+posKey]').equals(splitNk(nk)).delete();
      for (const nk of ops.del.cards) await t.cards.where('[repertoireId+posKey]').equals(splitNk(nk)).delete();
      for (const nk of ops.del.marks) await t.marks.delete(splitNk(nk));
      for (const uid of ops.del.reviews) await t.reviews.where('uid').equals(uid).delete();
      for (const id of ops.del.studies ?? []) await t.studies.delete(id);
      await t.repertoires.bulkPut(ops.put.repertoires);
      if (ops.put.studies?.length) await t.studies.bulkPut(ops.put.studies);
      // Züge/Karten: gleiche Stellung kann lokal eine andere ID haben, daher erst ersetzen (eindeutiger Index)
      for (const m of ops.put.moves) {
        await t.moves.where('[repertoireId+posKey]').equals([m.repertoireId, m.posKey]).delete();
        await t.moves.put(m);
      }
      for (const c of ops.put.cards) {
        await t.cards.where('[repertoireId+posKey]').equals([c.repertoireId, c.posKey]).delete();
        await t.cards.put(c);
      }
      await t.marks.bulkPut(ops.put.marks);
      if (ops.reviews.length) await t.reviews.bulkAdd(ops.reviews.map(({ id: _id, ...r }) => r as ReviewLog));
      if (ops.settings) {
        const cur = await t.settings.get('settings');
        await t.settings.put({ ...ops.settings, id: 'settings', explorer: { ...ops.settings.explorer, token: cur?.explorer.token } } as Settings);
      }
      if (ops.tombstones.length) await t.tombstones.bulkPut(ops.tombstones);
    });
  }

  /** Ersetzt alle Repertoire-Daten durch das Backup. Token und Caches bleiben erhalten. */
  async importAll(b: BackupFile): Promise<void> {
    if (b.app !== 'RepLab' || b.version !== 1) throw new Error('Keine gültige RepLab-Sicherung (Version 1).');
    const token = (await this.getSettings()).explorer.token;
    const reviews = b.reviews.map((r) => ({ ...r, uid: r.uid ?? newId() }));
    await this.db.transaction(
      'rw',
      [this.db.repertoires, this.db.moves, this.db.marks, this.db.cards, this.db.reviews, this.db.settings, this.db.tombstones, this.db.studies],
      async () => {
        // Was lokal existiert, aber nicht in der Sicherung steht, gilt als gelöscht (auch für den Sync)
        const now = Date.now();
        const gone = <T,>(local: T[], incoming: T[], key: (x: T) => string) => {
          const keep = new Set(incoming.map(key));
          return local.map(key).filter((k) => !keep.has(k));
        };
        await this.tomb('repertoires', gone(await this.db.repertoires.toArray(), b.repertoires, (x) => x.id), now);
        await this.tomb('moves', gone(await this.db.moves.toArray(), b.moves, (x) => naturalKey('moves', x)), now);
        await this.tomb('marks', gone(await this.db.marks.toArray(), b.marks, (x) => naturalKey('marks', x)), now);
        await this.tomb('cards', gone(await this.db.cards.toArray(), b.cards, (x) => naturalKey('cards', x)), now);
        await Promise.all([this.db.repertoires.clear(), this.db.moves.clear(), this.db.marks.clear(), this.db.cards.clear(), this.db.reviews.clear()]);
        await this.db.repertoires.bulkPut(b.repertoires);
        await this.db.moves.bulkPut(b.moves);
        await this.db.marks.bulkPut(b.marks);
        await this.db.cards.bulkPut(b.cards);
        await this.db.reviews.bulkPut(reviews.map(({ id: _id, ...r }) => r as ReviewLog));
        if (b.settings) await this.db.settings.put({ ...b.settings, id: 'settings', explorer: { ...b.settings.explorer, token } });
        // Studien nur ersetzen, wenn die Sicherung welche enthält (ältere Sicherungen kennen sie nicht)
        if (b.studies) {
          await this.tomb('studies', gone(await this.db.studies.toArray(), b.studies, (x) => x.id), now);
          await this.db.studies.clear();
          await this.db.studies.bulkPut(b.studies);
        }
      },
    );
  }
}

export interface BackupFile {
  app: 'RepLab';
  version: 1;
  exportedAt: number;
  repertoires: Repertoire[];
  moves: RepertoireMove[];
  marks: PositionMark[];
  cards: Card[];
  reviews: ReviewLog[];
  /** Studien (ab 11/2026; ältere Sicherungen haben das Feld nicht → lokale Studien bleiben unberührt) */
  studies?: Study[];
  settings?: Settings;
}

export const repo = new Repo();
