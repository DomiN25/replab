// Bottom-Sheet für „Bauen“ am Handy: liegt unter dem Brett (Ruhezustand füllt den Platz darunter)
// und lässt sich am Griff/Kopf nach oben ziehen, bis es das Brett überdeckt. Tippen auf den Griff wechselt.
// Bewegt wird nur das Sheet (position: fixed) – das Brett bleibt stehen, damit chessground seine Position behält.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useBackClose } from './backClose';

export type SheetSnap = 'peek' | 'full';

interface Props {
  /** Element, unter dessen Unterkante das Sheet im Ruhezustand beginnt (Brett + Steuerung). */
  anchorRef: RefObject<HTMLElement>;
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  header: ReactNode;
  children: ReactNode;
}

const MIN_PEEK = 190; // px sichtbare Höhe mindestens (überdeckt sonst notfalls die unterste Brettreihe)
const DRAG_START = 6; // px, ab denen aus einem Tippen ein Ziehen wird

export function BottomSheet({ anchorRef, snap, onSnap, header, children }: Props) {
  const [tops, setTops] = useState({ peek: 0, full: 0, bottom: 0 });
  const [dragTop, setDragTop] = useState<number | undefined>();
  useBackClose(snap === 'full', () => onSnap('peek'));
  const drag = useRef<{ y0: number; top0: number; t0: number; moved: boolean; id: number } | undefined>(undefined);

  const measure = useCallback(() => {
    const vh = window.innerHeight;
    const nav = document.querySelector<HTMLElement>('.nav-bottom');
    const navH = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
    const bottom = vh - navH;
    const topbar = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const anchorBottom = anchorRef.current?.getBoundingClientRect().bottom ?? vh * 0.6;
    const peek = Math.min(anchorBottom + 6, bottom - MIN_PEEK);
    setTops({ peek: Math.max(peek, topbar + 40), full: topbar + 8, bottom });
  }, [anchorRef]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (anchorRef.current) ro.observe(anchorRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [measure, anchorRef]);

  // Esc schließt ein aufgezogenes Sheet
  useEffect(() => {
    if (snap !== 'full') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSnap('peek');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap, onSnap]);

  const restTop = snap === 'full' ? tops.full : tops.peek;
  const top = dragTop ?? restTop;

  // Ziehen: Touch über Touch-Events (Chrome bricht Pointer-Events beim Wischen teils mit pointercancel ab,
  // Touch-Events laufen weiter), Maus/Stift über Pointer-Events mit Capture.
  const start = (y: number, id: number) => {
    drag.current = { y0: y, top0: restTop, t0: performance.now(), moved: false, id };
  };
  const moveTo = (y: number, id: number): boolean => {
    const d = drag.current;
    if (!d || d.id !== id) return false;
    const dy = y - d.y0;
    if (!d.moved) {
      if (Math.abs(dy) < DRAG_START) return false;
      d.moved = true;
    }
    setDragTop(Math.min(tops.peek + 60, Math.max(tops.full, d.top0 + dy)));
    return true;
  };
  /** Ende einer Geste; true = es war nur ein Tippen. */
  const end = (y: number, id: number): boolean => {
    const d = drag.current;
    if (!d || d.id !== id) return false;
    drag.current = undefined;
    if (!d.moved) return true; // Tippen: Reiter bekommen ihren Klick normal
    const dy = y - d.y0;
    const v = dy / Math.max(1, performance.now() - d.t0); // px/ms
    const cur = d.top0 + dy;
    const next: SheetSnap = v < -0.4 ? 'full' : v > 0.4 ? 'peek' : cur < (tops.full + tops.peek) / 2 ? 'full' : 'peek';
    setDragTop(undefined);
    onSnap(next);
    return false;
  };
  const toggle = () => onSnap(snap === 'full' ? 'peek' : 'full');
  const cancel = () => {
    drag.current = undefined;
    setDragTop(undefined);
  };
  const lastY = useRef(0);
  const TOUCH = -1;

  return (
    <section
      className={`bsheet ${snap} ${dragTop !== undefined ? 'dragging' : ''}`}
      style={{ top, bottom: window.innerHeight - tops.bottom }}
      aria-label="Details zur Stellung"
    >
      <div
        className="bs-head"
        onPointerDown={(e) => e.pointerType !== 'touch' && e.button === 0 && start(e.clientY, e.pointerId)}
        onPointerMove={(e) => {
          if (e.pointerType === 'touch') return;
          const wasMoved = drag.current?.moved;
          if (moveTo(e.clientY, e.pointerId) && !wasMoved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => e.pointerType !== 'touch' && end(e.clientY, e.pointerId)}
        onPointerCancel={(e) => e.pointerType !== 'touch' && cancel()}
        onTouchStart={(e) => {
          if (e.touches.length !== 1) return cancel();
          lastY.current = e.touches[0].clientY;
          start(lastY.current, TOUCH);
        }}
        onTouchMove={(e) => {
          lastY.current = e.touches[0].clientY;
          moveTo(lastY.current, TOUCH);
        }}
        onTouchEnd={(e) => {
          // Griff per Touch selbst umschalten: Chrome lässt den Klick direkt nach einem Wischen manchmal aus.
          // preventDefault verhindert dann den zusätzlichen Klick (sonst doppelt umgeschaltet).
          if (end(lastY.current, TOUCH) && (e.target as HTMLElement).closest('.bs-grip')) {
            e.preventDefault();
            toggle();
          }
        }}
        onTouchCancel={cancel}
      >
        <button
          className="bs-grip"
          aria-label={snap === 'full' ? 'Details verkleinern' : 'Details vergrößern'}
          aria-expanded={snap === 'full'}
          onClick={toggle}
        />
        {header}
      </div>
      <div className="bs-body">{children}</div>
    </section>
  );
}
