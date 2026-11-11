import { useEffect, useRef, useState } from 'react';
import { explorer, explorerParams, engine, lichessToken, requestGraph, useApp } from './store';
import { repo } from '../data/repo';
import { posKeyOf } from '../core/chess';
import { effectiveDepth, MAX_DEPTH } from '../services/engine';
import type { EngineLine, ExplorerData } from '../core/types';
import { ExplorerAuthError } from '../services/explorer';
import { useInert } from './inert';

export interface ExplorerState {
  data?: ExplorerData;
  loading: boolean;
  error?: string;
}

/** Explorer-Daten der aktuellen Stellung (Cache zuerst, dann Netz mit hoher Priorität). */
export function useExplorer(fen: string, source: 'lichess' | 'masters'): ExplorerState {
  const [st, setSt] = useState<ExplorerState>({ loading: true });
  const settingsVersion = useApp((s) => s.settings.updatedAt);
  const inert = useInert();
  useEffect(() => {
    let alive = true;
    const params = explorerParams(source);
    setSt({ loading: true });
    (async () => {
      const cached = await explorer.cached(fen, params);
      if (!alive) return;
      if (cached) {
        setSt({ data: cached, loading: false });
        return;
      }
      if (inert) return setSt({ loading: false }); // Vorschau: nur aus dem Cache
      if (!lichessToken()) {
        setSt({ loading: false, error: 'Kein Lichess-Token – Datenbank nicht verfügbar (Einstellungen).' });
        return;
      }
      try {
        const d = await explorer.get(fen, params, { priority: 10 });
        if (!alive) return;
        setSt({ data: d, loading: false });
        if (source === 'lichess') requestGraph(400);
      } catch (e) {
        if (!alive) return;
        setSt({
          loading: false,
          error: e instanceof ExplorerAuthError ? e.message : navigator.onLine ? `Explorer-Fehler: ${String(e)}` : 'Offline – keine Datenbankdaten.',
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [fen, source, settingsVersion, inert]);
  return st;
}

export interface EngineState {
  /** Stellung, zu der lines gehören */
  fen: string;
  lines: EngineLine[];
  /** Bewertungen weiterer Kandidaten außerhalb der besten Linien (nur Anzeige) */
  extra: EngineLine[];
  depth: number;
  running: boolean;
  target: number;
}

export interface EngineOptions {
  /** nach der Grundtiefe weiterrechnen, solange die Stellung offen ist (bis MAX_DEPTH) */
  deep?: boolean;
  /** Züge (UCI), die auch dann eine Bewertung bekommen sollen, wenn sie nicht unter den besten Linien sind */
  extraMoves?: string[];
}

/**
 * Stockfish-Analyse der aktuellen Stellung in drei Schritten (ein Worker, nacheinander):
 * 1. Grundanalyse bis zur eingestellten Tiefe (Cache) → beste Linien.
 * 2. Kandidaten ohne Bewertung (extraMoves) gezielt nachrechnen („searchmoves“, etwas flacher).
 * 3. Mit „deep“ weiterrechnen, bis man weiterklickt – die Anzeige wird nur durch tiefere Ergebnisse ersetzt.
 */
export function useEngine(fen: string, enabled: boolean, opts: EngineOptions = {}): EngineState {
  const depthSetting = useApp((s) => s.settings.engine.depth);
  const multipv = useApp((s) => s.settings.engine.multipv);
  const target = effectiveDepth(depthSetting);
  const deep = !!opts.deep;
  const extraKey = (opts.extraMoves ?? []).join(' ');
  const [st, setSt] = useState<EngineState>({ fen, lines: [], extra: [], depth: 0, running: false, target });
  const handle = useRef<{ cancel: () => void } | undefined>(undefined);
  const inert = useInert();

  useEffect(() => {
    let alive = true;
    setSt({ fen, lines: [], extra: [], depth: 0, running: false, target });
    if (!enabled || inert) return;
    const posKey = posKeyOf(fen);
    const run = (o: { depth: number; multipv: number; searchmoves?: string[] }, onUpdate: (lines: EngineLine[], depth: number) => void) => {
      const h = engine().analyse(fen, o, (lines, depth) => alive && onUpdate(lines, depth));
      handle.current = h;
      return h.done;
    };
    const timer = setTimeout(async () => {
      const cached = await repo.getEngine(posKey);
      if (!alive) return;
      let base = cached && cached.depth >= target && cached.lines.length >= Math.min(multipv, cached.lines.length) ? cached : undefined;
      let extra = cached?.extra ?? [];
      if (base) setSt({ fen, lines: base.lines, extra, depth: base.depth, running: true, target });
      else {
        // 1. Grundanalyse
        setSt((s) => ({ ...s, running: true }));
        const res = await run({ depth: target, multipv }, (lines, depth) => setSt((s) => ({ ...s, lines, depth, running: true })));
        if (res && res.depth >= Math.min(12, target)) {
          await repo.putEngine({ ...res, extra });
          requestGraph(800); // Engine-Regel / Fallen können Lücken ändern
          if (res.depth >= target) base = res;
        }
      }
      if (!alive) return;
      if (!base) return setSt((s) => ({ ...s, running: false }));

      // 2. Kandidaten ohne Bewertung nachrechnen
      const have = new Set(base.lines.map((l) => l.uci));
      extra = extra.filter((e) => !have.has(e.uci));
      const missing = (extraKey ? extraKey.split(' ') : []).filter((u) => !have.has(u) && !extra.some((e) => e.uci === u)).slice(0, 8);
      if (missing.length) {
        const before = extra;
        const res = await run({ depth: Math.max(8, Math.min(target, 12)), multipv: missing.length, searchmoves: missing }, (lines) =>
          setSt((s) => ({ ...s, extra: [...before, ...lines] })),
        );
        if (res?.lines.length) {
          extra = [...before, ...res.lines.filter((l) => missing.includes(l.uci))];
          await repo.putEngine({ ...base, extra });
        }
        if (!alive) return;
        setSt((s) => ({ ...s, extra }));
      }

      // 3. Weiterrechnen, solange die Stellung offen und die Seite sichtbar ist
      if (deep && base.depth < MAX_DEPTH && document.visibilityState === 'visible') {
        const from = base.depth;
        const res = await run({ depth: MAX_DEPTH, multipv }, (lines, depth) => {
          if (depth > from && lines.length >= Math.min(multipv, base!.lines.length)) setSt((s) => ({ ...s, lines, depth, running: true }));
        });
        if (res && res.depth > from && res.lines.length >= base.lines.length) {
          const keep = new Set(res.lines.map((l) => l.uci));
          await repo.putEngine({ ...res, extra: extra.filter((e) => !keep.has(e.uci)) });
          requestGraph(800);
        }
      }
      if (alive) setSt((s) => ({ ...s, running: false }));
    }, 120); // kurzes Entprellen beim schnellen Durchklicken
    // Seite im Hintergrund: nicht weiterrechnen (Akku)
    const onHide = () => document.visibilityState === 'hidden' && handle.current?.cancel();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
      handle.current?.cancel();
      handle.current = undefined;
    };
  }, [fen, enabled, inert, target, multipv, deep, extraKey]);
  return st;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => (typeof matchMedia !== 'undefined' ? matchMedia(q).matches : false));
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
