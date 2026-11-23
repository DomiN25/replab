// Wie stand ich nach der Abweichung? Je Partie die Stellung direkt nach dem Ereignis-Zug (bzw. nach dem letzten Repertoire-Zug)
// bewerten: aus der Lichess-Analyse, falls vorhanden, sonst lokal mit Stockfish im Hintergrund – nacheinander, neueste Partien
// zuerst, gemerkt pro Stellung (localStorage, nur dieses Gerät). Läuft nur, solange Start- oder Partien-Seite sichtbar ist.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { fenOf, posKeyOf, positionFromFen, START_FEN } from '../core/chess';
import { assess, evalPlyOf, whiteCp, type Assessment } from '../core/gameReview';
import type { Color } from '../core/types';
import { isMobileDevice } from '../services/engine';
import type { Row } from './gameRows';
import { engine } from './store';

const KEY = 'replab.gameEvals';
const MAX_ENTRIES = 3000;
/** so viele der neuesten Partien werden höchstens lokal bewertet */
const MAX_ENGINE_GAMES = 150;

function read(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

let evals: Record<string, number> = read();
const listeners = new Set<() => void>();
function put(posKey: string, cp: number) {
  evals = { ...evals, [posKey]: cp };
  const keys = Object.keys(evals);
  if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete evals[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(evals));
  } catch {
    /* voll/blockiert: bleibt im Speicher */
  }
  listeners.forEach((l) => l());
}

function useEvalStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => evals,
  );
}

interface Target {
  key: string;
  fen: string;
  posKey: string;
  /** Bewertung aus der Lichess-Analyse (Weiß-Sicht), falls vorhanden */
  lichess?: number;
}

/** Stellung nach n Halbzügen der Partie */
export function fenAfter(sans: string[], n: number): string | undefined {
  const pos: Chess = positionFromFen(START_FEN);
  for (let i = 0; i < n; i++) {
    const mv = sans[i] ? parseSan(pos, sans[i]) : undefined;
    if (!mv) return undefined;
    pos.play(mv);
  }
  return fenOf(pos);
}

// ---- Hintergrund-Analyse (eine Warteschlange für die ganze App)
let queue: Target[] = [];
let runner: { cancel: () => void } | undefined;
let loop: Promise<void> | undefined;
let wanted = 0;

async function runLoop() {
  const depth = isMobileDevice() ? 11 : 14;
  while (wanted > 0 && queue.length) {
    const t = queue.shift()!;
    if (evals[t.posKey] !== undefined) continue;
    const h = engine().analyse(t.fen, { depth, multipv: 1 }, () => {});
    runner = h;
    const res = await h.done;
    runner = undefined;
    if (wanted <= 0) {
      queue.unshift(t); // abgebrochen: später erneut
      break;
    }
    const top = res?.lines[0];
    const cp = top && res!.depth >= depth - 2 ? whiteCp(t.fen, top.cp, top.mate) : undefined;
    if (cp !== undefined) put(t.posKey, cp);
    await new Promise((r) => setTimeout(r, 20)); // Luft für die Oberfläche
  }
  loop = undefined;
  listeners.forEach((l) => l());
}

/**
 * Bewertungen für die übergebenen Partien. enabled = false: nichts im Hintergrund rechnen (z. B. vorgeladene Seite
 * oder offene Brett-Ansicht, die die Engine selbst braucht).
 */
export function useAssessments(rows: Row[], color: Color, enabled: boolean): { of: (key: string) => Assessment | undefined; pending: number } {
  const store = useEvalStore();
  const targets = useMemo(() => {
    const out: Target[] = [];
    for (const r of rows) {
      const sans = r.game.m.split(' ').filter(Boolean);
      const n = evalPlyOf(r.rev, sans.length);
      if (n <= 0) continue;
      const fen = fenAfter(sans, n);
      if (!fen) continue;
      const ev = r.game.ev?.[n - 1];
      out.push({ key: r.key, fen, posKey: posKeyOf(fen), lichess: ev });
    }
    return out;
  }, [rows]);

  // Was noch fehlt (ohne Lichess-Wert und ohne gemerkte Bewertung) → Warteschlange, neueste Partien zuerst
  const missing = useMemo(() => {
    const seen = new Set<string>();
    return targets
      .slice(0, MAX_ENGINE_GAMES)
      .filter((t) => t.lichess === undefined && store[t.posKey] === undefined && !seen.has(t.posKey) && !!seen.add(t.posKey));
  }, [targets, store]);

  // An/Aus: beim Ausschalten laufende Analyse abbrechen und Warteschlange leeren
  useEffect(() => {
    if (!enabled) return;
    wanted++;
    return () => {
      wanted--;
      if (wanted <= 0) {
        runner?.cancel();
        queue = [];
      }
    };
  }, [enabled]);
  // Warteschlange: bei jeder Änderung neu (z. B. wenn das Repertoire nachlädt und sich die Prüfung ändert), ohne Abbruch
  const sig = missing.map((t) => t.posKey).join('|');
  useEffect(() => {
    if (!enabled || !missing.length) return;
    queue = missing.slice();
    if (!loop) loop = runLoop();
  }, [enabled, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = useMemo(() => {
    const m = new Map<string, Assessment>();
    // aus meiner Sicht in genau dieser Partie (die Startseite mischt beide Farben)
    const mine = (w: number, c: 'w' | 'b') => (c === 'w' ? w : -w);
    for (const t of targets) {
      const w = t.lichess ?? store[t.posKey];
      const r = rows.find((x) => x.key === t.key);
      if (w !== undefined && r) m.set(t.key, assess(r.rev, mine(w, r.game.c)));
    }
    return m;
  }, [targets, store, rows, color]);

  return { of: (k) => byKey.get(k), pending: enabled ? missing.length : 0 };
}

/** Bewertung kurz: „+1,2“ / „−0,8“ (aus meiner Sicht), Matt als „Matt“ */
export function fmtCp(cp: number): string {
  if (Math.abs(cp) >= 1000) return cp > 0 ? 'Matt für dich' : 'Matt gegen dich';
  const v = (cp / 100).toFixed(1).replace('.', ',');
  return cp > 0 ? `+${v}` : cp < 0 ? `−${v.slice(1)}` : '0,0';
}
