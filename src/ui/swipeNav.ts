// Wischen zwischen den Hauptseiten am Handy (Start ↔ Bauen ↔ Lücken ↔ Training ↔ Studien).
// Die Seite folgt dem Finger; ab ~28 % Breite oder schnellem Wisch wechselt sie, sonst federt sie zurück.
// Geht überall in der App (Kopf, Inhalt, Sheet, Navigation) – außer dort, wo Gesten schon etwas bedeuten:
// - Brett: nur auf freien Feldern. chessground ruft bei Absicht zum Ziehen (Figur, Auswahl, Figur in der Nähe)
//   preventDefault auf; solche Gesten bleiben beim Brett.
// - Zugleiste unter dem Brett (Wischen = Zug vor/zurück), quer scrollende Leisten, Eingaben, Dialoge,
//   aufgezogenes Sheet, laufende Trainingssitzung. Rand-Wische gehören der Android-Zurück-Geste.
import { useEffect, type RefObject } from 'react';

const BLOCK = ['.board-controls', '.bsheet.full', '.modal-backdrop', '.rowmenu-pop', 'input', 'select', 'textarea', '[data-noswipe]'].join(',');
const EDGE = 24; // px am Bildschirmrand: System-Geste
const LOCK = 10; // px, ab denen die Richtung feststeht

/** Liegt das Ziel in einem Element, das selbst quer scrollt? */
function inHorizontalScroller(el: HTMLElement | null, stop: HTMLElement): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n instanceof SVGElement) continue;
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

/** Elemente, die beim Ziehen mitwandern. Ein fest positioniertes Sheet würde in einem verschobenen
 *  Container mitspringen – daher auf Seiten mit Sheet Brettspalte und Sheet einzeln verschieben. */
function movers(main: HTMLElement): HTMLElement[] {
  const page = main.firstElementChild as HTMLElement | null;
  if (!page) return [];
  const sheet = page.querySelector<HTMLElement>('.bsheet');
  if (!sheet) return [page];
  return [...page.querySelectorAll<HTMLElement>(':scope > .col-board'), sheet];
}

/** rootRef: Bereich, in dem gewischt werden kann (ganze App); mainRef: Seiteninhalt, der mitwandert. */
export function useSwipeNav(rootRef: RefObject<HTMLElement>, mainRef: RefObject<HTMLElement>, opts: { prev?: () => void; next?: () => void; enabled: boolean }) {
  const { prev, next, enabled } = opts;
  useEffect(() => {
    const root = rootRef.current;
    const main = mainRef.current;
    if (!root || !main || !enabled || !matchMedia('(max-width: 899px)').matches) return;
    let s: { x: number; y: number; t: number; dir?: 'h' | 'v'; dx: number; els: HTMLElement[] } | undefined;

    const reset = (els: HTMLElement[], animate: boolean) => {
      for (const el of els) {
        el.style.transition = animate ? 'translate 0.28s var(--ease-out), opacity 0.28s var(--ease-out)' : '';
        el.style.translate = '';
        el.style.opacity = '';
      }
      if (animate) setTimeout(() => els.forEach((el) => (el.style.transition = '')), 300);
    };

    const onStart = (e: TouchEvent) => {
      s = undefined;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return;
      if (e.defaultPrevented) return; // Brett will ziehen (Figur/Auswahl in der Nähe)
      if (!(target instanceof Element) || target.closest(BLOCK) || inHorizontalScroller(target as HTMLElement, root)) return;
      if (document.querySelector('.modal-backdrop, .trainer')) return;
      s = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, els: [] };
    };

    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.dir) {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
        s.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
        if (s.dir === 'v') {
          s = undefined;
          return;
        }
        s.els = movers(main);
      }
      e.preventDefault(); // waagerecht: Seite nicht gleichzeitig scrollen
      const has = dx < 0 ? !!next : !!prev;
      // Ohne Nachbarn nur leichter Widerstand (Gummiband)
      const shown = has ? dx : dx * 0.18;
      s.dx = dx;
      const fade = has ? Math.min(0.5, Math.abs(dx) / innerWidth) : 0;
      for (const el of s.els) {
        el.style.transition = 'none';
        el.style.translate = `${shown}px 0`;
        el.style.opacity = String(1 - fade);
      }
    };

    const onEnd = () => {
      const st = s;
      s = undefined;
      if (!st || st.dir !== 'h') return;
      const v = Math.abs(st.dx) / Math.max(1, performance.now() - st.t);
      const go = st.dx < 0 ? next : prev;
      const far = Math.abs(st.dx) > innerWidth * 0.28 || (v > 0.45 && Math.abs(st.dx) > 40);
      if (!go || !far) return reset(st.els, true);
      // Rausgleiten, dann wechseln (die neue Seite gleitet von der anderen Seite herein, siehe app.css)
      for (const el of st.els) {
        el.style.transition = 'translate 0.14s ease-in, opacity 0.14s ease-in';
        el.style.translate = `${Math.sign(st.dx) * innerWidth * 0.35}px 0`;
        el.style.opacity = '0';
      }
      setTimeout(() => {
        reset(st.els, false);
        go();
      }, 130);
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [rootRef, mainRef, prev, next, enabled]);
}
