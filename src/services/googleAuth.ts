// Google-Anmeldung im Browser (Google Identity Services, Token-Modell).
// Ohne eigenen Server gibt es nur Zugangstokens (~1 h), keinen Refresh-Token. Ist der Token
// abgelaufen, muss der Nutzer einmal tippen (Popup braucht eine Nutzeraktion).

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const LS_TOKEN = 'replab.gtoken';
const LS_CLIENT = 'replab.googleClientId';
const LS_CONSENT = 'replab.gconsent';

export class NeedsSignIn extends Error {
  constructor() {
    super('Google-Anmeldung nötig');
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GisOauth2 {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): { requestAccessToken(o?: { prompt?: string }): void };
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* privat/blockiert */
  }
}

/** Client-ID: im Gerät hinterlegt (Einstellungen) oder beim Build eingebaut (GitHub-Variable). */
export function googleClientId(): string | undefined {
  return ls(LS_CLIENT)?.trim() || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || undefined;
}

export function builtInClientId(): boolean {
  return !!(import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
}

export function setGoogleClientId(id: string | undefined) {
  lsSet(LS_CLIENT, id?.trim() ? id.trim() : null);
}

/** Gültiger Token (mit 60 s Sicherheitsabstand) oder undefined. */
export function storedToken(): string | undefined {
  const raw = ls(LS_TOKEN);
  if (!raw) return undefined;
  try {
    const t = JSON.parse(raw) as { token: string; exp: number };
    return t.exp - 60_000 > Date.now() ? t.token : undefined;
  } catch {
    return undefined;
  }
}

export function forgetToken() {
  lsSet(LS_TOKEN, null);
}

let gis: Promise<void> | undefined;
/** GIS-Skript laden (vorab aufrufen, damit der Klick später sofort ein Popup öffnen kann). */
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gis ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gis = undefined;
      reject(new Error('Google-Anmeldung konnte nicht geladen werden (offline?).'));
    };
    document.head.appendChild(s);
  });
  return gis;
}

/**
 * Zugangstoken für drive.appdata. interactive=false: nur gespeicherter Token (sonst NeedsSignIn).
 * interactive=true: öffnet bei Bedarf das Google-Popup (muss aus einem Klick heraus aufgerufen werden).
 */
export async function getGoogleToken(interactive: boolean): Promise<string> {
  const t = storedToken();
  if (t) return t;
  if (!interactive) throw new NeedsSignIn();
  const clientId = googleClientId();
  if (!clientId) throw new Error('Keine Google-Client-ID hinterlegt (Einstellungen → Sync).');
  await loadGis();
  const oauth2 = window.google!.accounts!.oauth2!;
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(`Google: ${r.error_description ?? r.error ?? 'kein Token'}`));
          return;
        }
        lsSet(LS_TOKEN, JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }));
        lsSet(LS_CONSENT, '1');
        resolve(r.access_token);
      },
      error_callback: (e) => {
        reject(new Error(e.type === 'popup_closed' ? 'Anmeldung abgebrochen.' : e.type === 'popup_failed_to_open' ? 'Popup blockiert – bitte Popups für diese Seite erlauben.' : `Google: ${e.message ?? e.type ?? 'Fehler'}`));
      },
    });
    client.requestAccessToken({ prompt: ls(LS_CONSENT) ? '' : 'consent' });
  });
}

/** Abmelden: Token widerrufen und lokal vergessen. */
export function signOutGoogle() {
  const raw = ls(LS_TOKEN);
  forgetToken();
  lsSet(LS_CONSENT, null);
  try {
    const t = raw ? (JSON.parse(raw) as { token: string }).token : undefined;
    if (t) window.google?.accounts?.oauth2?.revoke(t);
  } catch {
    /* egal */
  }
}
