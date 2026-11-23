// Neue eigene Partien automatisch holen: beim Start der App und beim Zurückkehren (App wieder sichtbar), höchstens alle
// 15 Minuten. Nur wenn ein Lichess- bzw. Chess.com-Name hinterlegt ist. Still im Hintergrund; Meldung nur bei neuen Partien.
import { loadNewGames, type GameSource } from './games';
import { lichessToken, setView, toast, useApp } from './store';

const KEY = 'replab.gamesAuto';
const EVERY_MS = 15 * 60_000;
let busy = false;

function lastRun(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export async function autoLoadGames(force = false): Promise<number> {
  if (busy || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
  if (!force && Date.now() - lastRun() < EVERY_MS) return 0;
  const ui = useApp.getState().settings.ui;
  const names: [GameSource, string | undefined][] = [
    ['chesscom', ui.chesscomUser?.trim()],
    ['lichess', ui.lichessUser?.trim()],
  ];
  if (!names.some(([, n]) => n)) return 0;
  busy = true;
  let n = 0;
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* privat/blockiert */
  }
  try {
    for (const [src, name] of names) {
      if (!name) continue;
      try {
        n += await loadNewGames(src, name, src === 'lichess' ? lichessToken() : undefined);
      } catch {
        /* Netz/Limit: beim nächsten Mal erneut */
      }
    }
  } finally {
    busy = false;
  }
  if (n > 0) toast(n === 1 ? '1 neue Partie geladen' : `${n} neue Partien geladen`, 'ok', { label: 'Ansehen', run: () => setView('home') });
  return n;
}

let installed = false;
/** Einmal beim Start: sofort prüfen und bei jedem Zurückkehren in die App erneut (mit Mindestabstand). */
export function installAutoGames() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  void autoLoadGames();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void autoLoadGames();
  });
}
