// Laufende Trainingssitzung: überlebt Reiterwechsel (im Speicher) und Neuladen/App-Schließen (localStorage, pro Gerät).
// Die Bewertungen selbst stehen ohnehin sofort in der Datenbank; hier geht es um Reihenfolge, Relearning und Fortschritt.
import type { Session } from '../core/session';

export interface SavedSession {
  repId: string;
  session: Session;
  startedAt: number;
  stats: { right: number; wrong: number };
  savedAt: number;
}

const KEY = 'replab.session';
const MAX_AGE = 3 * 86400_000; // ältere Sitzungen sind nicht mehr sinnvoll fortzusetzen (Fälligkeiten haben sich verschoben)

let active: SavedSession | undefined;

function read(): SavedSession | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as SavedSession;
    if (!s?.session?.steps || Date.now() - s.savedAt > MAX_AGE) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Sitzung im Speicher (z. B. nach „Stellung im Repertoire öffnen“) – wird ohne Rückfrage fortgesetzt. */
export function activeSession(repId: string | undefined): SavedSession | undefined {
  return active && active.repId === repId && active.session.index < active.session.steps.length ? active : undefined;
}

/** Gespeicherte, nicht beendete Sitzung von früher (nach Neuladen) – wird zum Fortsetzen angeboten. */
export function storedSession(repId: string | undefined): SavedSession | undefined {
  const s = read();
  return s && s.repId === repId && s.session.index < s.session.steps.length ? s : undefined;
}

export function beginSession(repId: string, session: Session): SavedSession {
  active = { repId, session, startedAt: Date.now(), stats: { right: 0, wrong: 0 }, savedAt: Date.now() };
  persistSession(active);
  return active;
}

export function resumeSession(s: SavedSession): SavedSession {
  active = s;
  return s;
}

export function persistSession(s: SavedSession) {
  s.savedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* privates Fenster o. Ä.: dann nur im Speicher */
  }
}

/** Pausieren: Sitzung bleibt gespeichert, nur nicht mehr „aktiv“ (Trainingsseite bietet Fortsetzen an). */
export function pauseSession() {
  if (active) persistSession(active);
  active = undefined;
}

export function clearSession() {
  active = undefined;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
}
