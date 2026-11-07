// chessground-Brett als React-Komponente. Legale Züge kommen aus chessops.
import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape, DrawBrushes } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { positionFromFen, turnOf } from '../core/chess';
import type { Color } from '../core/types';

export const BRUSHES = {
  mine: { key: 'mi', color: '#46e3ad', opacity: 0.95, lineWidth: 15 },
  opp: { key: 'op', color: '#f5b54a', opacity: 0.9, lineWidth: 10 },
  eng: { key: 'en', color: '#5aa9ff', opacity: 0.95, lineWidth: 5 },
  wrong: { key: 'wr', color: '#ff6b6b', opacity: 0.9, lineWidth: 10 },
};

export interface BoardProps {
  fen: string;
  orientation: Color;
  lastMove?: [string, string];
  /** Wer ziehen darf: 'turn' = Seite am Zug, 'none' = nur ansehen. */
  movable?: 'turn' | Color | 'none';
  shapes?: DrawShape[];
  onMove?: (uci: string) => void;
  /** Feld-Hervorhebungen (CSS-Klassen) */
  highlights?: Map<Key, string>;
  animationMs?: number;
}

export function uciSquares(uci?: string): [Key, Key] | undefined {
  if (!uci || uci.length < 4) return undefined;
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}

export function Board({ fen, orientation, lastMove, movable = 'turn', shapes, onMove, highlights, animationMs = 200 }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | undefined>(undefined);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // Nach einem Zug: Wenn die App die Stellung nicht ändert (z. B. falscher Zug im Training),
  // muss chessground auf den Prop-Stand zurückgesetzt werden – sonst bleibt der Zug intern stehen.
  const latestConfig = useRef<() => Config>(() => ({}));
  const pendingSync = useRef(false);

  const config = (): Config => {
    let pos;
    try {
      pos = positionFromFen(fen);
    } catch {
      pos = undefined;
    }
    const turn = turnOf(fen);
    const canMove = movable === 'none' ? undefined : movable === 'turn' ? turn : movable === turn ? turn : undefined;
    return {
      fen: fen.split(' ')[0],
      orientation,
      turnColor: turn,
      lastMove: lastMove as Key[] | undefined,
      check: pos?.isCheck() ?? false,
      coordinates: true,
      animation: { enabled: animationMs > 0, duration: animationMs },
      highlight: { lastMove: true, check: true, custom: highlights },
      movable: {
        free: false,
        color: canMove,
        dests: pos && canMove ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map(),
        showDests: true,
      },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: true, visible: true, eraseOnClick: true },
      events: {
        move: (orig, dest) => {
          // Umwandlung: automatisch Dame (in Eröffnungen praktisch immer richtig)
          const piece = pos?.board.get(squareIndex(orig));
          const promo = piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
          pendingSync.current = true;
          onMoveRef.current?.(orig + dest + promo);
          setTimeout(() => {
            if (pendingSync.current) {
              pendingSync.current = false;
              api.current?.set(latestConfig.current());
            }
          }, 40);
        },
      },
    };
  };

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      ...config(),
      drawable: { enabled: true, visible: true, brushes: { ...defaultBrushes(), ...BRUSHES } as unknown as DrawBrushes },
    });
    return () => {
      api.current?.destroy();
      api.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  latestConfig.current = config;

  useEffect(() => {
    pendingSync.current = false;
    api.current?.set(config());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], movable, highlights, animationMs]);

  useEffect(() => {
    api.current?.setAutoShapes(shapes ?? []);
  }, [shapes]);

  return <div className="board-wrap"><div ref={el} className="cg-board-host" /></div>;
}

function squareIndex(k: string): number {
  return (k.charCodeAt(0) - 97) + (Number(k[1]) - 1) * 8;
}

function defaultBrushes() {
  return {
    green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
    red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
    blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
    yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
    paleBlue: { key: 'pb', color: '#003088', opacity: 0.4, lineWidth: 15 },
    paleGreen: { key: 'pg', color: '#15781B', opacity: 0.4, lineWidth: 15 },
    paleRed: { key: 'pr', color: '#882020', opacity: 0.4, lineWidth: 15 },
    paleGrey: { key: 'pgr', color: '#4a4a4a', opacity: 0.35, lineWidth: 15 },
    purple: { key: 'purple', color: '#68217a', opacity: 0.65, lineWidth: 10 },
    pink: { key: 'pink', color: '#ee2080', opacity: 0.5, lineWidth: 10 },
    white: { key: 'white', color: 'white', opacity: 1, lineWidth: 10 },
  };
}
