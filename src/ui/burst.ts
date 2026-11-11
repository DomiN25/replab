// Kleiner Funkenkranz am zuletzt getippten Punkt (Hub-Idee „Abhaken“): Belohnungs-Feedback bei richtiger Antwort und „Verstanden“.
// Nur translate/opacity per Web Animations, räumt sich selbst auf, respektiert „weniger Bewegung“.
import { prefersReducedMotion } from './hooks';

let last: { x: number; y: number; t: number } | undefined;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (last = { x: e.clientX, y: e.clientY, t: Date.now() }), { capture: true, passive: true });
}

/** Funken am letzten Tippunkt (max. 4 s alt), sonst Bildschirmmitte. */
export function burst(color = '--me') {
  if (prefersReducedMotion() || typeof document === 'undefined' || typeof document.body.animate !== 'function') return;
  const at = last && Date.now() - last.t < 4000 ? last : { x: innerWidth / 2, y: innerHeight * 0.45 };
  const css = getComputedStyle(document.documentElement);
  const col = css.getPropertyValue(color).trim() || '#2ecc8c';
  const box = document.createElement('div');
  box.className = 'burst';
  document.body.appendChild(box);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    el.style.background = col;
    box.appendChild(el);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 34 + Math.random() * 26;
    el.animate(
      [
        { translate: '0 0', scale: 1, opacity: 1 },
        { translate: `${Math.cos(a) * d}px ${Math.sin(a) * d}px`, scale: 0.2, opacity: 0 },
      ],
      { duration: 520 + Math.random() * 180, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
  }
  setTimeout(() => box.remove(), 900);
}
