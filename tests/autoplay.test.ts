import { describe, it, expect } from 'vitest';
import { autoDelay, autoNext, AUTO_SPEEDS, LEAD_MS, leadFor, speedMs } from '../src/core/autoplay';

describe('Geführter Studien-Modus (Abspielen)', () => {
  it('Vorspiel nur am Linienanfang, höchstens 3 Züge', () => {
    expect(leadFor(10, 0)).toBe(3);
    expect(leadFor(2, 0)).toBe(2);
    expect(leadFor(0, 0)).toBe(0);
    expect(leadFor(10, 4)).toBe(0);
  });

  it('Ablauf: erst Orientierungszüge, dann Linienzüge, am Ende Stopp', () => {
    let lead = 2;
    let step = 0;
    const len = 3;
    const log: string[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const a = autoNext({ lead, step, len });
      log.push(a.kind);
      if (a.kind === 'stop') break;
      if (a.kind === 'lead') lead--;
      else step++;
    }
    expect(log).toEqual(['lead', 'lead', 'step', 'step', 'step', 'stop']);
  });

  it('Geschwindigkeit: schnell < mittel < langsam, Vorspiel immer zügig', () => {
    const [slow, normal, fast] = ['slow', 'normal', 'fast'].map((s) => speedMs(s as 'slow'));
    expect(fast).toBeLessThan(normal);
    expect(normal).toBeLessThan(slow);
    expect(speedMs(undefined)).toBe(AUTO_SPEEDS[1].ms);
    expect(autoDelay({ kind: 'lead' }, 'slow', 0)).toBe(LEAD_MS);
    expect(autoDelay({ kind: 'step' }, 'normal', 0)).toBeLessThan(autoDelay({ kind: 'step' }, 'normal', 3));
    expect(autoDelay({ kind: 'stop' }, 'normal', 3)).toBe(0);
  });
});
