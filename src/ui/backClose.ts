// Android-Zurück-Taste (und Browser-Zurück) schließt zuerst offene Overlays (Dialog, aufgezogenes Sheet),
// statt die Ansicht zu wechseln. Jedes offene Overlay legt einen Verlaufseintrag mit derselben URL an (Stapel).
// Zurück schließt nur das oberste Overlay. Schließt der Nutzer ein Overlay selbst, wird sein Eintrag
// per history.back() wieder entfernt – dieses „eigene“ Zurück wird ignoriert.
// Robust gegen schnelles Öffnen/Schließen (und React-StrictMode): neue Einträge erst, wenn ein eigenes
// Zurück durch ist; Zurück nur, wenn der eigene Eintrag wirklich der aktuelle ist.
import { useEffect, useRef } from 'react';

interface Entry {
  id: number;
  close: () => void;
  pushed: boolean;
  dead: boolean;
}
const stack: Entry[] = [];
let ownBacks = 0; // ausstehende history.back()-Aufrufe, die wir selbst ausgelöst haben
const waiters: (() => void)[] = [];
let listening = false;

function onPopState() {
  if (ownBacks > 0) {
    ownBacks--;
    if (ownBacks === 0) waiters.splice(0).forEach((f) => f());
    return;
  }
  // Nutzer hat Zurück gedrückt: oberstes (eingetragenes) Overlay schließen
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].pushed) {
      const [top] = stack.splice(i, 1);
      top.dead = true;
      top.close();
      return;
    }
  }
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

/** Navigation erst ausführen, wenn ein gerade angestoßenes history.back() durch ist (sonst würde es sie zurücknehmen). */
export function afterPendingBack(fn: () => void) {
  if (ownBacks === 0) fn();
  else waiters.push(fn);
}

export function useBackClose(active: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!active || typeof history === 'undefined') return;
    ensureListener();
    const entry: Entry = { id: Math.random(), close: () => cb.current(), pushed: false, dead: false };
    stack.push(entry);
    afterPendingBack(() => {
      if (entry.dead) return;
      history.pushState({ ...(history.state ?? {}), replabOverlay: entry.id }, '');
      entry.pushed = true;
    });
    return () => {
      if (entry.dead) return; // schon per Zurück geschlossen
      entry.dead = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.pushed && history.state?.replabOverlay === entry.id) {
        ownBacks++;
        history.back();
      }
    };
  }, [active]);
}
