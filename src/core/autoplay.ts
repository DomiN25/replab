// Geführter Studien-Modus („Abspielen“): Die letzten Züge vor dem Abzweig laufen kurz mit, danach spielen sich die
// neuen Züge der Linie von allein ab – in einstellbarer Geschwindigkeit, bis der Nutzer eingreift. (UI-frei, getestet)
export type AutoSpeed = 'slow' | 'normal' | 'fast';

export const AUTO_SPEEDS: { id: AutoSpeed; label: string; ms: number }[] = [
  { id: 'slow', label: 'langsam', ms: 3200 },
  { id: 'normal', label: 'mittel', ms: 1900 },
  { id: 'fast', label: 'schnell', ms: 1000 },
];

/** So viele Züge vor dem Abzweig werden zur Orientierung noch einmal vorgespielt. */
export const LEAD_PLIES = 3;
/** Takt des Vorspiels (Orientierungszüge laufen schneller als die neuen). */
export const LEAD_MS = 480;

export const speedMs = (s: AutoSpeed | undefined) => (AUTO_SPEEDS.find((x) => x.id === s) ?? AUTO_SPEEDS[1]).ms;

/** Orientierungszüge beim Start: nur am Linienanfang, höchstens LEAD_PLIES und nicht mehr als der Weg lang ist. */
export function leadFor(startLen: number, step: number): number {
  return step === 0 ? Math.min(LEAD_PLIES, startLen) : 0;
}

export type AutoAction = { kind: 'lead' } | { kind: 'step' } | { kind: 'stop' };

/** Was als Nächstes passiert: Orientierungszug einblenden, Linienzug spielen oder am Ende anhalten. */
export function autoNext(s: { lead: number; step: number; len: number }): AutoAction {
  if (s.lead > 0) return { kind: 'lead' };
  if (s.step < s.len) return { kind: 'step' };
  return { kind: 'stop' };
}

/** Wartezeit bis zur Aktion. Der erste neue Zug kommt etwas früher (der Abzweig ist ja gerade erst gezeigt worden). */
export function autoDelay(a: AutoAction, speed: AutoSpeed | undefined, step: number): number {
  if (a.kind === 'lead') return LEAD_MS;
  if (a.kind === 'step') return step === 0 ? Math.round(speedMs(speed) * 0.7) : speedMs(speed);
  return 0;
}
