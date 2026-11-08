// UI-Anbindung des Google-Drive-Syncs: Start-Sync, Sync nach Änderungen, Status für Kopfzeile/Einstellungen.
import { loadRepData, reloadRepertoires, reloadSettings, toast, useApp } from './store';
import { repo } from '../data/repo';
import { SyncEngine, watchChanges } from '../services/syncEngine';
import { DriveAuthError, DriveClient } from '../services/drive';
import { forgetToken, getGoogleToken, googleClientId, loadGis, NeedsSignIn, signOutGoogle, storedToken } from '../services/googleAuth';

export type SyncStatus = 'off' | 'syncing' | 'ok' | 'needs-auth' | 'error';

export interface SyncUiState {
  status: SyncStatus;
  connected: boolean;
  configured: boolean; // Client-ID vorhanden
  dirty: boolean; // lokale Änderungen noch nicht im Drive
  lastSyncAt?: number;
  error?: string;
}

const LS = 'replab.sync';
const DEBOUNCE_MS = 4000;

function loadMeta(): Pick<SyncUiState, 'connected' | 'dirty' | 'lastSyncAt'> {
  try {
    const m = JSON.parse(localStorage.getItem(LS) ?? '{}');
    return { connected: !!m.connected, dirty: !!m.dirty, lastSyncAt: m.lastSyncAt };
  } catch {
    return { connected: false, dirty: false };
  }
}

function setSync(p: Partial<SyncUiState>) {
  useApp.setState((s) => ({ sync: { ...s.sync, ...p } }));
  const s = useApp.getState().sync;
  try {
    localStorage.setItem(LS, JSON.stringify({ connected: s.connected, dirty: s.dirty, lastSyncAt: s.lastSyncAt }));
  } catch {
    /* egal */
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const engine = new SyncEngine({
  repo,
  drive: () => new DriveClient({ token: () => storedToken() ?? '' }),
  onApplied: async () => {
    await reloadRepertoires();
    await reloadSettings();
    await loadRepData();
  },
});

/**
 * Synchronisieren. interactive=true nur aus einem Klick heraus (öffnet ggf. das Google-Popup).
 */
export async function syncNow(interactive: boolean): Promise<void> {
  if (!googleClientId()) {
    setSync({ status: 'error', error: 'Keine Google-Client-ID hinterlegt.' });
    if (interactive) toast('Keine Google-Client-ID hinterlegt (Einstellungen → Sync).', 'err');
    return;
  }
  try {
    await getGoogleToken(interactive);
  } catch (e) {
    if (e instanceof NeedsSignIn) {
      setSync({ status: 'needs-auth' });
      return;
    }
    setSync({ status: 'error', error: msg(e) });
    if (interactive) toast(msg(e), 'err');
    return;
  }
  setSync({ status: 'syncing', connected: true, error: undefined });
  try {
    const r = await engine.sync();
    setSync({ status: 'ok', lastSyncAt: Date.now(), dirty: false });
    if (interactive) {
      const parts = [r.pulled ? `${r.pulled} geholt` : '', r.uploaded ? 'hochgeladen' : '', r.deleted ? `${r.deleted} gelöscht` : ''].filter(Boolean);
      toast(`Synchronisiert${parts.length ? ': ' + parts.join(', ') : ' – alles aktuell'}`, 'ok');
    } else if (r.localChanged) toast(`Sync: ${r.pulled} Änderungen von einem anderen Gerät übernommen`, 'info');
  } catch (e) {
    if (e instanceof DriveAuthError) {
      forgetToken();
      setSync({ status: 'needs-auth' });
      if (interactive) toast('Google-Anmeldung abgelaufen – bitte noch einmal tippen.', 'err');
      return;
    }
    setSync({ status: 'error', error: msg(e) });
    if (interactive) toast(`Sync fehlgeschlagen: ${msg(e)}`, 'err');
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Nach lokalen Änderungen: als „ungesichert“ markieren und verzögert synchronisieren. */
function onLocalChange() {
  const s = useApp.getState().sync;
  if (!s.dirty) setSync({ dirty: true });
  if (!s.connected) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (storedToken()) void syncNow(false);
    else setSync({ status: 'needs-auth' });
  }, DEBOUNCE_MS);
}

function syncIfStale() {
  const s = useApp.getState().sync;
  if (!s.connected || s.status === 'syncing') return;
  if (!storedToken()) {
    setSync({ status: 'needs-auth' });
    return;
  }
  if (s.dirty || !s.lastSyncAt || Date.now() - s.lastSyncAt > 60_000) void syncNow(false);
}

export function initSync() {
  const meta = loadMeta();
  setSync({ ...meta, configured: !!googleClientId(), status: meta.connected ? 'needs-auth' : 'off' });
  watchChanges(repo.db, onLocalChange, () => engine.applying);
  if (meta.connected) {
    void loadGis().catch(() => undefined); // vorladen, damit der Klick später sofort das Popup öffnen kann
    if (storedToken()) void syncNow(false);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncIfStale();
  });
  window.addEventListener('online', syncIfStale);
}

/** Verbinden (Klick in den Einstellungen). */
export async function connectSync() {
  await syncNow(true);
}

export function disconnectSync() {
  signOutGoogle();
  setSync({ connected: false, status: 'off', error: undefined });
  toast('Sync getrennt. Die Daten im Drive bleiben erhalten.', 'info');
}

export function refreshSyncConfig() {
  setSync({ configured: !!googleClientId() });
  if (googleClientId()) void loadGis().catch(() => undefined);
}

export function syncTitle(s: SyncUiState): string {
  const when = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–';
  switch (s.status) {
    case 'syncing':
      return 'Synchronisiere …';
    case 'ok':
      return s.dirty ? `Änderungen warten (letzter Sync ${when})` : `Synchronisiert ${when}`;
    case 'needs-auth':
      return `Sync pausiert${s.dirty ? ', ungesicherte Änderungen' : ''} – tippen zum Verbinden`;
    case 'error':
      return `Sync-Fehler: ${s.error ?? ''}`;
    default:
      return 'Sync aus';
  }
}
