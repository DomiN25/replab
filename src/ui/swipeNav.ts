// Wischen zwischen den Hauptseiten am Handy (Start ↔ Bauen ↔ Lücken ↔ Training ↔ Studien).
// Die Seite folgt dem Finger und die Nachbarseite wird schon daneben eingeblendet (wie die Slides im Hub): Sie wird beim Ziehen
// als Vorschau gemountet (App.tsx, „inert“ = ohne Engine/Abfragen). Ab ~28 % Breite oder schnellem Wisch wechselt die Seite, sonst federt sie zurück.
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

/** Wird nach einem Wisch-Wechsel gesetzt: die neue Seite steht schon im richtigen Bild und braucht keine Einblend-Animation. */
export const swipeFlag = { committed: false };

export interface PeekControl {
  /** Nachbarseite zeigen (side 1 = rechts/nächste, −1 = links/vorige) */
  show: (side: 1 | -1) => void;
  hide: () => void;
  /** die Vorschau-Ebene (nach show, sobald gerendert) */
  layer: () => HTMLElement | null;
}

/** rootRef: Bereich, in dem gewischt werden kann (ganze App); mainRef: Seiteninhalt, der mitwandert. */
export function useSwipeNav(
  rootRef: RefObject<HTMLElement>,
  mainRef: RefObject<HTMLElement>,
  opts: { prev?: () => void; next?: () => void; enabled: boolean; peek?: PeekControl },
) {
  const { prev, next, enabled, peek } = opts;
  useEffect(() => {
    const root = rootRef.current;
    const main = mainRef.current;
    if (!root || !main || !enabled || !matchMedia('(max-width: 899px)').matches) return;
    let s: { x: number; y: number; t: number; dir?: 'h' | 'v'; dx: number; els: HTMLElement[]; side?: 1 | -1 } | undefined;

    const clear = (els: HTMLElement[], animate: boolean) => {
      for (const el of els) {
        el.style.transition = animate ? 'translate 0.28s var(--ease-out)' : '';
        el.style.translate = '';
        el.style.willChange = '';
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
        // eigene Compositor-Ebene: Verschieben läuft ohne Neuzeichnen der ganzen Seite
        for (const el of s.els) el.style.willChange = 'translate';
      }
      e.preventDefault(); // waagerecht: Seite nicht gleichzeitig scrollen
      const side: 1 | -1 = dx < 0 ? 1 : -1;
      const has = side === 1 ? !!next : !!prev;
      // Ohne Nachbarn nur leichter Widerstand (Gummiband)
      const shown = has ? dx : dx * 0.18;
      s.dx = dx;
      if (has && s.side !== side) {
        s.side = side;
        peek?.show(side);
      } else if (!has && s.side) {
        s.side = undefined;
        peek?.hide();
      }
      for (const el of s.els) {
        el.style.transition = 'none';
        el.style.translate = `${shown}px 0`;
      }
      const layer = s.side ? peek?.layer() : null;
      if (layer) {
        layer.style.transition = 'none';
        layer.style.translate = `${s.side! * innerWidth + dx}px 0`;
      }
    };

    const onEnd = () => {
      const st = s;
      s = undefined;
      if (!st || st.dir !== 'h') return;
      const v = Math.abs(st.dx) / Math.max(1, performance.now() - st.t);
      const go = st.dx < 0 ? next : prev;
      const far = Math.abs(st.dx) > innerWidth * 0.28 || (v > 0.45 && Math.abs(st.dx) > 40);
      const layer = st.side ? peek?.layer() : null;
      if (!go || !far) {
        // zurückfedern: aktuelle Seite an den Platz, Vorschau wieder nach außen, dann abbauen
        clear(st.els, true);
        if (layer) {
          layer.style.transition = 'translate 0.28s var(--ease-out)';
          layer.style.translate = `${st.side! * innerWidth}px 0`;
        }
        if (st.side) setTimeout(() => peek?.hide(), 300);
        return;
      }
      // Weiter: die aktuelle Seite gleitet hinaus, die Nachbarseite an ihren Platz – ein Bild ohne Sprung. Danach wechselt die
      // echte Seite (gleiches Bild, deshalb ohne Einblend-Animation) und die Vorschau verschwindet im selben Schritt.
      const rest = Math.max(0.12, Math.min(0.26, (1 - Math.abs(st.dx) / innerWidth) * 0.34));
      const out = -Math.sign(st.dx) * innerWidth;
      for (const el of st.els) {
        el.style.transition = `translate ${rest}s var(--ease-out)`;
        el.style.translate = `${out}px 0`;
      }
      if (layer) {
        layer.style.transition = `translate ${rest}s var(--ease-out)`;
        layer.style.translate = '0px 0';
      }
      setTimeout(() => {
        swipeFlag.committed = !!layer;
        go();
        // Wechsel nicht zustande gekommen (gleiche Seite bleibt)? Dann aufräumen.
        setTimeout(() => {
          swipeFlag.committed = false;
          if (s) return; // schon die nächste Geste
          clear(st.els.filter((el) => el.isConnected), true);
          peek?.hide();
        }, 450);
      }, rest * 1000 + 20);
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
  }, [rootRef, mainRef, prev, next, enabled, peek]);
}
