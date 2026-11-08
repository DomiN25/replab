// Google Drive REST (v3) für eine einzelne Datei im versteckten App-Ordner (appDataFolder).
// Kein gapi nötig – reines fetch mit Bearer-Token.

export const SYNC_FILE = 'replab-sync.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveAuthError extends Error {
  constructor() {
    super('Google-Anmeldung abgelaufen – bitte neu verbinden.');
  }
}

export interface DriveFile {
  id: string;
  modifiedTime?: string;
}

/** Schnittstelle, gegen die der Sync-Ablauf arbeitet (im Test durch eine Fake-Implementierung ersetzt). */
export interface DriveStore {
  find(): Promise<DriveFile | undefined>;
  download(id: string): Promise<unknown>;
  create(content: unknown): Promise<DriveFile>;
  update(id: string, content: unknown): Promise<DriveFile>;
}

export class DriveClient implements DriveStore {
  constructor(private o: { token: () => string; fetch?: typeof fetch; fileName?: string }) {}

  private get file() {
    return this.o.fileName ?? SYNC_FILE;
  }

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const f = this.o.fetch ?? globalThis.fetch.bind(globalThis);
    const res = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.o.token()}` } });
    if (res.status === 401) throw new DriveAuthError();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg += ` – ${j?.error?.message ?? ''}`;
      } catch {
        /* kein JSON */
      }
      throw new Error(`Google Drive: ${msg}`);
    }
    return res;
  }

  async find(): Promise<DriveFile | undefined> {
    const q = encodeURIComponent(`name='${this.file}' and trashed=false`);
    const res = await this.req(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=10`);
    const j = (await res.json()) as { files?: DriveFile[] };
    const files = j.files ?? [];
    // Falls es (z. B. nach einem Wettlauf) mehrere gibt: die zuletzt geänderte
    return files.sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))[0];
  }

  async download(id: string): Promise<unknown> {
    const res = await this.req(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return res.json();
  }

  /** Zweistufig (Metadaten anlegen, dann Inhalt hochladen) – spart Multipart-Bodies. */
  async create(content: unknown): Promise<DriveFile> {
    const res = await this.req(`${API}/files?fields=id,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.file, parents: ['appDataFolder'], mimeType: 'application/json' }),
    });
    const meta = (await res.json()) as DriveFile;
    return this.update(meta.id, content);
  }

  async update(id: string, content: unknown): Promise<DriveFile> {
    const res = await this.req(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    });
    return (await res.json()) as DriveFile;
  }
}
