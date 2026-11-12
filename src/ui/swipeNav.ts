// Wischen zwischen den Hauptseiten am Handy (Start ↔ Bauen ↔ Lücken ↔ Training ↔ Studien).
// Wie die Slides im Hub: Die Nachbarseiten sind schon gemountet (App.tsx, „Spur“ mit eigenem Scroller je Seite) und warten unsichtbar
// neben der aktuellen. Beim Ziehen wird die Nachbarseite nur eingeblendet und mitverschoben – es wird nichts neu aufgebaut. Ab ~28 %
// Breite oder schnellem Wisch wechselt die Seite (nur die Rollen „aktiv/Nachbar“ tauschen), sonst federt sie zurück.
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

/** Elemente einer Seite, die beim Ziehen mitwandern. Ein fest positioniertes Sheet würde in einem verschobenen
 *  Container mitspringen – daher auf Seiten mit Sheet Brettspalte und Sheet einzeln verschieben. */
function movers(page: HTMLElement): HTMLElement[] {
  const root = page.firstElementChild as HTMLElement | null;
  if (!root) return [];
  const sheet = root.querySelector<HTMLElement>('.bsheet');
  if (!sheet) return [root];
  return [...root.querySelectorAll<HTMLElement>(':scope > .col-board'), sheet];
}

/** Wird nach einem Wisch-Wechsel gesetzt: die neue Seite steht schon im richtigen Bild (kein Einblenden nötig). */
export const swipeFlag = { committed: false };

/** Alle Spuren-Seiten in den Ruhezustand: keine Verschiebung, keine Übergänge, Nachbarn wieder unsichtbar. */
export function resetPages(pages: HTMLElement | null) {
  if (!pages) return;
  for (const page of Array.from(pages.children) as HTMLElement[]) {
    page.style.visibility = '';
    for (const el of movers(page)) {
      el.style.transition = '';
      el.style.translate = '';
      el.style.willChange = '';
    }
  }
}

export interface SwipeOpts {
  prev?: () => void;
  next?: () => void;
  enabled: boolean;
  /** der Spuren-Container (.pages) */
  pages: RefObject<HTMLElement>;
  /** Nachbarseite (side 1 = nächste, −1 = vorige), falls schon gemountet */
  neighbor: (side: 1 | -1) => HTMLElement | null;
  /** Nachbarseite sofort mounten lassen (falls sie noch nicht da ist) */
  want: (side: 1 | -1) => void;
}

interface Gesture {
  x: number;
  y: number;
  t: number;
  dir?: 'h' | 'v';
  dx: number;
  act: HTMLElement;
  actEls: HTMLElement[];
  side?: 1 | -1;
  nb?: HTMLElement;
  nbEls: HTMLElement[];
}

/** rootRef: Bereich, in dem gewischt werden kann (ganze App). */
export function useSwipeNav(rootRef: RefObject<HTMLElement>, opts: SwipeOpts) {
  const { prev, next, enabled, pages, neighbor, want } = opts;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || !matchMedia('(max-width: 899px)').matches) return;
    let s: Gesture | undefined;

    const activePage = () => pages.current?.querySelector<HTMLElement>(':scope > .page.active') ?? null;

    const clear = (els: HTMLElement[], animate: boolean) => {
      for (const el of els) {
        el.style.transition = animate ? 'translate 0.28s var(--ease-out)' : '';
        el.style.translate = '';
        el.style.willChange = '';
      }
      if (animate) setTimeout(() => els.forEach((el) => (el.style.transition = '')), 300);
    };
    /** Nachbarseite wieder verstecken (Geste abgebrochen oder vorbei) */
    const conceal = (nb: HTMLElement | undefined, els: HTMLElement[]) => {
      if (!nb) return;
      clear(els, false);
      nb.style.visibility = '';
    };
    /** Nachbarseite einblenden: gleich neben der aktuellen, auf eigener Compositor-Ebene */
    const reveal = (g: Gesture, side: 1 | -1) => {
      const nb = neighbor(side);
      if (!nb) {
        want(side); // noch nicht gemountet: laden lassen, mit der nächsten Bewegung erneut versuchen
        return;
      }
      g.nb = nb;
      g.nbEls = movers(nb);
      nb.style.visibility = 'visible';
      for (const el of g.nbEls) {
        el.style.willChange = 'translate';
        el.style.transition = 'none';
        el.style.translate = `${side * innerWidth + g.dx}px 0`;
      }
    };

    const onStart = (e: TouchEvent) => {
      s = undefined;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return;
      if (e.defaultPrevented) return; // Brett will ziehen (Figur/Auswahl in der Nähe)
      if (!(target instanceof Element) || target.closest(BLOCK) || inHorizontalScroller(target as HTMLElement, root)) return;
      if (document.querySelector('.modal-backdrop, .pages > .active .trainer')) return;
      const act = activePage();
      if (!act) return;
      s = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, act, actEls: [], nbEls: [] };
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
        s.actEls = movers(s.act);
        for (const el of s.actEls) el.style.willChange = 'translate';
      }
      e.preventDefault(); // waagerecht: Seite nicht gleichzeitig scrollen
      const side: 1 | -1 = dx < 0 ? 1 : -1;
      const has = side === 1 ? !!next : !!prev;
      // Ohne Nachbarn nur leichter Widerstand (Gummiband)
      const shown = has ? dx : dx * 0.18;
      s.dx = dx;
      if (s.side !== undefined && (!has || s.side !== side)) {
        // Richtung gewechselt: vorherige Nachbarseite wieder wegräumen
        conceal(s.nb, s.nbEls);
        s.nb = undefined;
        s.nbEls = [];
        s.side = undefined;
      }
      if (has && s.side === undefined) {
        s.side = side;
        reveal(s, side);
      } else if (has && !s.nb) {
        reveal(s, side);
      }
      for (const el of s.actEls) {
        el.style.transition = 'none';
        el.style.translate = `${shown}px 0`;
      }
      if (s.nb && s.side) {
        for (const el of s.nbEls) el.style.translate = `${s.side * innerWidth + dx}px 0`;
      }
    };

    const onEnd = () => {
      const st = s;
      s = undefined;
      if (!st) return;
      if (st.dir !== 'h') return; // Tippen/senkrechtes Scrollen: nichts angefasst
      const v = Math.abs(st.dx) / Math.max(1, performance.now() - st.t);
      const go = st.dx < 0 ? next : prev;
      const far = Math.abs(st.dx) > innerWidth * 0.28 || (v > 0.45 && Math.abs(st.dx) > 40);
      if (!go || !far) {
        // zurückfedern: aktuelle Seite an den Platz, Nachbarseite wieder nach außen, dann verstecken
        clear(st.actEls, true);
        for (const el of st.nbEls) {
          el.style.transition = 'translate 0.28s var(--ease-out)';
          el.style.translate = `${st.side! * innerWidth}px 0`;
        }
        if (st.nb) setTimeout(() => !s && conceal(st.nb, st.nbEls), 300);
        return;
      }
      // Weiter: die aktuelle Seite gleitet hinaus, die Nachbarseite an ihren Platz – ein Bild ohne Sprung. Danach tauschen nur die
      // Rollen (aktiv/Nachbar); App.tsx setzt die Verschiebungen im selben Schritt zurück. Die Animation läuft auf dem Compositor
      // und bleibt flüssig, auch wenn der Hauptthread gerade arbeitet.
      const rest = Math.max(0.12, Math.min(0.26, (1 - Math.abs(st.dx) / innerWidth) * 0.34));
      const out = -Math.sign(st.dx) * innerWidth;
      for (const el of st.actEls) {
        el.style.transition = `translate ${rest}s var(--ease-out)`;
        el.style.translate = `${out}px 0`;
      }
      for (const el of st.nbEls) {
        el.style.transition = `translate ${rest}s var(--ease-out)`;
        el.style.translate = '0px 0';
      }
      setTimeout(() => {
        swipeFlag.committed = !!st.nb;
        go();
        // Wechsel nicht zustande gekommen (gleiche Seite bleibt)? Dann aufräumen.
        setTimeout(() => {
          swipeFlag.committed = false;
          if (s) return; // schon die nächste Geste
          if (activePage() === st.act) {
            clear(st.actEls.filter((el) => el.isConnected), true);
            conceal(st.nb, st.nbEls);
          }
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
  }, [rootRef, pages, prev, next, enabled, neighbor, want]);
}
