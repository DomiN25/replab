import { useEffect, useRef, useState } from 'react';
import { explorer, explorerParams, engine, lichessToken, requestGraph, useApp } from './store';
import { repo } from '../data/repo';
import { posKeyOf } from '../core/chess';
import { effectiveDepth } from '../services/engine';
import type { EngineLine, ExplorerData } from '../core/types';
import { ExplorerAuthError } from '../services/explorer';

export interface ExplorerState {
  data?: ExplorerData;
  loading: boolean;
  error?: string;
}

/** Explorer-Daten der aktuellen Stellung (Cache zuerst, dann Netz mit hoher Priorität). */
export function useExplorer(fen: string, source: 'lichess' | 'masters'): ExplorerState {
  const [st, setSt] = useState<ExplorerState>({ loading: true });
  const settingsVersion = useApp((s) => s.settings.updatedAt);
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
  }, [fen, source, settingsVersion]);
  return st;
}

export interface EngineState {
  /** Stellung, zu der lines gehören */
  fen: string;
  lines: EngineLine[];
  depth: number;
  running: boolean;
  target: number;
}

/** Stockfish-Analyse der aktuellen Stellung; Cache, schrittweise Updates, Abbruch beim Weiterklicken. */
export function useEngine(fen: string, enabled: boolean): EngineState {
  const depthSetting = useApp((s) => s.settings.engine.depth);
  const multipv = useApp((s) => s.settings.engine.multipv);
  const target = effectiveDepth(depthSetting);
  const [st, setSt] = useState<EngineState>({ fen, lines: [], depth: 0, running: false, target });
  const handle = useRef<{ cancel: () => void } | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setSt({ fen, lines: [], depth: 0, running: false, target });
    if (!enabled) return;
    const posKey = posKeyOf(fen);
    const timer = setTimeout(async () => {
      const cached = await repo.getEngine(posKey);
      if (!alive) return;
      if (cached && cached.depth >= target && cached.lines.length >= Math.min(multipv, cached.lines.length)) {
        setSt({ fen, lines: cached.lines, depth: cached.depth, running: false, target });
        return;
      }
      setSt((s) => ({ ...s, running: true }));
      const h = engine().analyse(fen, { depth: target, multipv }, (lines, depth) => {
        if (alive) setSt({ fen, lines, depth, running: true, target });
      });
      handle.current = h;
      const res = await h.done;
      if (res && res.depth >= Math.min(12, target)) {
        await repo.putEngine(res);
        requestGraph(800); // Engine-Regel / Fallen können Lücken ändern
      }
      if (alive) setSt((s) => ({ ...s, running: false }));
    }, 120); // kurzes Entprellen beim schnellen Durchklicken
    return () => {
      alive = false;
      clearTimeout(timer);
      handle.current?.cancel();
      handle.current = undefined;
    };
  }, [fen, enabled, target, multipv]);
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
