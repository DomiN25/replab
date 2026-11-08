// Integration: Drive-Client (gemocktes fetch) und Sync-Ablauf zwischen zwei Geräten (Fake-Drive).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { DriveClient, DriveAuthError, type DriveFile, type DriveStore } from '../src/services/drive';
import { SyncEngine, watchChanges } from '../src/services/syncEngine';
import { RepDB } from '../src/data/db';
import { Repo } from '../src/data/repo';
import { START_FEN } from '../src/core/chess';
import { fenAfter } from './helpers';

let n = 0;
const fresh = () => new Repo(new RepDB(`eng-${n++}`));

/** Drive im Speicher: eine Datei, zählt Zugriffe. */
class FakeDrive implements DriveStore {
  file?: { id: string; body: string; modifiedTime: string };
  calls = { find: 0, download: 0, create: 0, update: 0 };
  async find(): Promise<DriveFile | undefined> {
    this.calls.find++;
    return this.file ? { id: this.file.id, modifiedTime: this.file.modifiedTime } : undefined;
  }
  async download(): Promise<unknown> {
    this.calls.download++;
    return JSON.parse(this.file!.body);
  }
  async create(content: unknown): Promise<DriveFile> {
    this.calls.create++;
    this.file = { id: 'f1', body: JSON.stringify(content), modifiedTime: new Date().toISOString() };
    return { id: 'f1' };
  }
  async update(id: string, content: unknown): Promise<DriveFile> {
    this.calls.update++;
    this.file = { id, body: JSON.stringify(content), modifiedTime: new Date().toISOString() };
    return { id };
  }
}

describe('DriveClient (REST)', () => {
  it('sucht im appDataFolder, lädt herunter, legt an und aktualisiert – mit Bearer-Token', async () => {
    const seen: { url: string; method: string; auth: string }[] = [];
    let stored = '';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      seen.push({ url, method: init?.method ?? 'GET', auth: h.Authorization });
      if (url.includes('/drive/v3/files?spaces=appDataFolder')) return Response.json({ files: stored ? [{ id: 'abc', modifiedTime: 'x' }] : [] });
      if (url.includes('/drive/v3/files?fields=')) return Response.json({ id: 'abc' });
      if (url.includes('/upload/drive/v3/files/abc')) {
        stored = String(init!.body);
        return Response.json({ id: 'abc' });
      }
      if (url.includes('/drive/v3/files/abc?alt=media')) return new Response(stored, { headers: { 'Content-Type': 'application/json' } });
      return new Response('?', { status: 404 });
    });
    const d = new DriveClient({ token: () => 'tok', fetch: fetchMock as unknown as typeof fetch });
    expect(await d.find()).toBeUndefined();
    await d.create({ hello: 1 });
    expect((await d.find())!.id).toBe('abc');
    expect(await d.download('abc')).toEqual({ hello: 1 });
    await d.update('abc', { hello: 2 });
    expect(await d.download('abc')).toEqual({ hello: 2 });
    expect(seen.every((s) => s.auth === 'Bearer tok')).toBe(true);
    expect(decodeURIComponent(seen[0].url)).toContain("name='replab-sync.json' and trashed=false");
    const post = seen.find((s) => s.method === 'POST')!;
    expect(post.url).toContain('/drive/v3/files?fields=');
  });

  it('401 → DriveAuthError (neu verbinden)', async () => {
    const d = new DriveClient({ token: () => 't', fetch: (async () => new Response('', { status: 401 })) as unknown as typeof fetch });
    await expect(d.find()).rejects.toBeInstanceOf(DriveAuthError);
  });
});

describe('SyncEngine', () => {
  it('PC lädt hoch, Handy holt, Handy ändert, PC holt – Drive-Datei bleibt eine', async () => {
    const drive = new FakeDrive();
    const pc = fresh();
    const phone = fresh();
    const r = await pc.createRepertoire('W', 'white');
    await pc.setMove(r.id, START_FEN, 'e2e4', 'e4');

    const ePc = new SyncEngine({ repo: pc, drive: () => drive });
    const ePhone = new SyncEngine({ repo: phone, drive: () => drive });

    const a = await ePc.sync();
    expect(a.uploaded).toBe(true);
    expect(drive.calls.create).toBe(1);

    const b = await ePhone.sync();
    expect(b.localChanged).toBe(true);
    expect(b.uploaded).toBe(false); // nichts Neues vom Handy
    expect((await phone.getMoves(r.id)).map((m) => m.san)).toEqual(['e4']);

    await new Promise((res) => setTimeout(res, 3));
    await phone.setMove(r.id, fenAfter(['e4', 'c5']), 'g1f3', 'Nf3');
    const c = await ePhone.sync();
    expect(c.uploaded).toBe(true);

    const d = await ePc.sync();
    expect(d.localChanged).toBe(true);
    expect((await pc.getMoves(r.id)).map((m) => m.san).sort()).toEqual(['Nf3', 'e4']);
    expect(drive.calls.create).toBe(1); // nie eine zweite Datei

    // stabil: nichts mehr zu tun
    const e = await ePc.sync();
    expect(e.uploaded).toBe(false);
    expect(e.localChanged).toBe(false);
  });

  it('nur ein Sync gleichzeitig; Änderungen währenddessen lösen einen zweiten aus', async () => {
    const drive = new FakeDrive();
    const repo = fresh();
    const eng = new SyncEngine({ repo, drive: () => drive });
    const p1 = eng.sync();
    const p2 = eng.sync(); // während p1 läuft
    await Promise.all([p1, p2]);
    expect(drive.calls.find).toBe(2); // genau ein Nachlauf, nicht parallel
  });

  it('Änderungs-Hooks feuern bei eigenen Änderungen, nicht beim Anwenden von Drive-Daten', async () => {
    const drive = new FakeDrive();
    const pc = fresh();
    const r = await pc.createRepertoire('W', 'white');
    await pc.setMove(r.id, START_FEN, 'e2e4', 'e4');
    await new SyncEngine({ repo: pc, drive: () => drive }).sync();

    const phone = fresh();
    const eng = new SyncEngine({ repo: phone, drive: () => drive });
    let changes = 0;
    watchChanges(phone.db, () => changes++, () => eng.applying);
    await eng.sync(); // wendet Drive-Daten an
    await new Promise((res) => setTimeout(res, 10));
    expect(changes).toBe(0);
    await phone.setMove(r.id, fenAfter(['e4', 'e5']), 'g1f3', 'Nf3');
    await new Promise((res) => setTimeout(res, 10));
    expect(changes).toBeGreaterThan(0);
  });

  it('fremdes Dateiformat im Drive wird nicht überschrieben', async () => {
    const drive = new FakeDrive();
    drive.file = { id: 'x', body: JSON.stringify({ irgendwas: true }), modifiedTime: '' };
    const eng = new SyncEngine({ repo: fresh(), drive: () => drive });
    await expect(eng.sync()).rejects.toThrow(/unbekanntes Format/);
    expect(drive.calls.update).toBe(0);
  });
});
