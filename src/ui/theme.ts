// Darstellung pro Gerät (nicht im Sync): Farbschema und Brett-Farben.
// Wirkt über Attribute an <html> (data-theme, data-board); die Farben selbst stehen als CSS-Variablen in app.css.
import { useEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type BoardTheme = 'ozean' | 'holz' | 'schiefer' | 'lavendel';

/** Brett-Paletten: [hell, dunkel] – nur für die Vorschau in den Einstellungen, die echten Werte stehen in app.css. */
export const BOARD_THEMES: { id: BoardTheme; label: string; sq: [string, string] }[] = [
  { id: 'ozean', label: 'Ozean', sq: ['#e6eff6', '#86a9c6'] },
  { id: 'holz', label: 'Holz', sq: ['#f0d9b5', '#b58863'] },
  { id: 'schiefer', label: 'Schiefer', sq: ['#e3e6ea', '#8c97a4'] },
  { id: 'lavendel', label: 'Lavendel', sq: ['#ece8f5', '#9e93c4'] },
];

const K_THEME = 'replab.theme';
const K_BOARD = 'replab.board';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* privates Fenster o. Ä.: dann eben nur für diese Sitzung */
  }
}

export function themeMode(): ThemeMode {
  const v = read(K_THEME);
  return v === 'light' || v === 'dark' ? v : 'auto';
}
export function boardTheme(): BoardTheme {
  const v = read(K_BOARD);
  return BOARD_THEMES.some((b) => b.id === v) ? (v as BoardTheme) : 'ozean';
}

const prefersDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
export const isDark = (m: ThemeMode = themeMode()) => m === 'dark' || (m === 'auto' && prefersDark());

/** Attribute an <html> setzen und die Browserleiste (theme-color) mitfärben. */
export function applyTheme() {
  const root = document.documentElement;
  const m = themeMode();
  if (m === 'auto') delete root.dataset.theme;
  else root.dataset.theme = m;
  root.dataset.board = boardTheme();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark(m) ? '#0d1620' : '#eaf2f8');
}

let watching = false;
/** Einmal beim Start: Theme anwenden und Systemwechsel (hell/dunkel) verfolgen. */
export function initTheme() {
  applyTheme();
  if (watching || typeof matchMedia === 'undefined') return;
  watching = true;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

export function useAppearance() {
  const [mode, setModeState] = useState<ThemeMode>(themeMode);
  const [board, setBoardState] = useState<BoardTheme>(boardTheme);
  useEffect(() => applyTheme(), [mode, board]);
  return {
    mode,
    board,
    setMode: (m: ThemeMode) => {
      write(K_THEME, m);
      setModeState(m);
    },
    setBoard: (b: BoardTheme) => {
      write(K_BOARD, b);
      setBoardState(b);
    },
  };
}
