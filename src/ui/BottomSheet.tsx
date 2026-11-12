// Bottom-Sheet am Handy (Bauen, Studien). Drei Zustände:
// - „min“: eingeklappt – nur Griff + Reiter als schmale Leiste über der Navigation (Brett frei)
// - „peek“: Ruhezustand unter dem Brett (füllt den Platz darunter; entfällt, wenn darunter kein Platz ist)
// - „full“: aufgezogen bis unter die Kopfleiste
// Wischen am Kopf wechselt stufenweise, der Pfeil-Knopf klappt ein/aus, Tippen auf den Griff zieht auf/zu.
// Bewegt wird nur das Sheet (position: fixed) – das Brett bleibt stehen, damit chessground seine Position behält.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useBackClose } from './backClose';
import { Icon } from './Icon';

export type SheetSnap = 'min' | 'peek' | 'full';

interface Props {
  /** Element, unter dessen Unterkante das Sheet im Ruhezustand beginnt (Brett + Steuerung). */
  anchorRef: RefObject<HTMLElement>;
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  header: ReactNode;
  children: ReactNode;
  /** eingeklappt ganz verstecken (Lernmodus der Studien: geöffnet wird über einen Knopf) */
  hiddenAtMin?: boolean;
}

const MIN_PEEK = 190; // px sichtbare Höhe im Ruhezustand mindestens
const DRAG_START = 6; // px, ab denen aus einem Tippen ein Ziehen wird

export function BottomSheet({ anchorRef, snap, onSnap, header, children, hiddenAtMin }: Props) {
  const [tops, setTops] = useState({ min: 0, peek: 0, full: 0, bottom: 0, peekUseful: true });
  const [dragTop, setDragTop] = useState<number | undefined>();
  const headRef = useRef<HTMLDivElement>(null);
  useBackClose(snap === 'full', () => onSnap(tops.peekUseful ? 'peek' : 'min'));
  const drag = useRef<{ x0: number; y0: number; top0: number; t0: number; moved: boolean; id: number } | undefined>(undefined);

  const measure = useCallback(() => {
    const vh = window.innerHeight;
    const nav = document.querySelector<HTMLElement>('.nav-bottom');
    const navH = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
    const bottom = vh - navH;
    const topbar = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const headH = headRef.current?.getBoundingClientRect().height ?? 60;
    const anchorBottom = anchorRef.current?.getBoundingClientRect().bottom ?? vh * 0.6;
    const min = bottom - headH;
    // Ruhezustand nur, wenn unter dem Brett wirklich Platz ist – sonst würde er die Steuerung überdecken
    const peekUseful = anchorBottom + 6 <= bottom - MIN_PEEK;
    const peek = peekUseful ? anchorBottom + 6 : min;
    setTops({ min, peek: Math.max(peek, topbar + 40), full: topbar + 8, bottom, peekUseful });
  }, [anchorRef]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (anchorRef.current) ro.observe(anchorRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    const scroller = document.querySelector('.app > main'); // Handy: nur main scrollt
    scroller?.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      scroller?.removeEventListener('scroll', measure);
    };
  }, [measure, anchorRef]);

  // Ruhezustand ohne Platz → eingeklappt
  const effective: SheetSnap = snap === 'peek' && (!tops.peekUseful || hiddenAtMin) ? 'min' : snap;
  const hidden = !!hiddenAtMin && effective === 'min';

  // Esc klappt ein aufgezogenes Sheet zurück
  useEffect(() => {
    if (effective !== 'full') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSnap(tops.peekUseful ? 'peek' : 'min');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effective, onSnap, tops.peekUseful]);

  const restTop = hidden ? tops.bottom + 12 : effective === 'full' ? tops.full : effective === 'peek' ? tops.peek : tops.min;
  const top = dragTop ?? restTop;

  // Ziehen: Touch über Touch-Events (Chrome bricht Pointer-Events beim Wischen teils mit pointercancel ab,
  // Touch-Events laufen weiter), Maus/Stift über Pointer-Events mit Capture.
  const start = (y: number, id: number, x = 0) => {
    drag.current = { x0: x, y0: y, top0: restTop, t0: performance.now(), moved: false, id };
  };
  const moveTo = (y: number, id: number, x?: number): boolean => {
    const d = drag.current;
    if (!d || d.id !== id) return false;
    const dy = y - d.y0;
    if (!d.moved) {
      const dx = x === undefined ? 0 : x - d.x0;
      if (Math.abs(dx) >= DRAG_START && Math.abs(dx) > Math.abs(dy)) {
        drag.current = undefined; // waagerecht: Seitenwechsel (swipeNav), nicht das Sheet ziehen
        return false;
      }
      if (Math.abs(dy) < DRAG_START) return false;
      d.moved = true;
    }
    setDragTop(Math.min(tops.min, Math.max(tops.full, d.top0 + dy)));
    return true;
  };
  /** Ende einer Geste; true = es war nur ein Tippen. */
  const end = (y: number, id: number): boolean => {
    const d = drag.current;
    if (!d || d.id !== id) return false;
    drag.current = undefined;
    if (!d.moved) return true; // Tippen: Reiter und Knöpfe bekommen ihren Klick normal
    const dy = y - d.y0;
    const v = dy / Math.max(1, performance.now() - d.t0); // px/ms
    const cur = d.top0 + dy;
    const stops: [SheetSnap, number][] = [['full', tops.full], ...(tops.peekUseful ? ([['peek', tops.peek]] as [SheetSnap, number][]) : []), ['min', tops.min]];
    const idx = stops.findIndex(([s]) => s === effective);
    let next: SheetSnap;
    if (v < -0.4) next = stops[Math.max(0, idx - 1)][0]; // schnell nach oben: eine Stufe auf
    else if (v > 0.4) next = stops[Math.min(stops.length - 1, idx + 1)][0]; // schnell nach unten: eine Stufe zu
    else next = stops.reduce((a, b) => (Math.abs(b[1] - cur) < Math.abs(a[1] - cur) ? b : a))[0]; // nächste Stufe
    setDragTop(undefined);
    onSnap(next);
    return false;
  };
  const toggle = () => onSnap(effective === 'full' ? (tops.peekUseful ? 'peek' : 'min') : 'full');
  const cancel = () => {
    drag.current = undefined;
    setDragTop(undefined);
  };
  const lastY = useRef(0);
  const TOUCH = -1;

  return (
    <section
      className={`bsheet ${effective} ${hidden ? 'hidden' : ''} ${dragTop !== undefined ? 'dragging' : ''}`}
      aria-hidden={hidden || undefined}
      style={{ top, bottom: window.innerHeight - tops.bottom }}
      aria-label="Details zur Stellung"
    >
      <div
        className="bs-head"
        ref={headRef}
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
          start(lastY.current, TOUCH, e.touches[0].clientX);
        }}
        onTouchMove={(e) => {
          lastY.current = e.touches[0].clientY;
          moveTo(lastY.current, TOUCH, e.touches[0].clientX);
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
          aria-label={effective === 'full' ? 'Details verkleinern' : 'Details vergrößern'}
          aria-expanded={effective === 'full'}
          onClick={toggle}
        />
        <div className="bs-headrow">
          {header}
          <button
            className="bs-min"
            aria-label={effective === 'min' ? 'Details aufklappen' : 'Details einklappen'}
            title={effective === 'min' ? 'Aufklappen' : 'Einklappen'}
            onClick={() => onSnap(effective === 'min' ? 'full' : 'min')}
          >
            <Icon name="next" className={effective === 'min' ? 'up' : 'down'} />
          </button>
        </div>
      </div>
      <div className="bs-body" aria-hidden={effective === 'min'}>
        {children}
      </div>
    </section>
  );
}
