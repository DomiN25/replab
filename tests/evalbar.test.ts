import { describe, expect, it } from 'vitest';
import { barLabel, whiteShare } from '../src/ui/EvalBar';

describe('Bewertungsbalken', () => {
  it('0,00 = halb/halb, Vorteil Weiß = mehr Weiß, symmetrisch', () => {
    expect(whiteShare({ cp: 0 })).toBe(50);
    expect(whiteShare({ cp: 100 })).toBeGreaterThan(55);
    expect(whiteShare({ cp: 100 }) + whiteShare({ cp: -100 })).toBeCloseTo(100);
  });
  it('große Vorteile werden begrenzt, Matt füllt ganz', () => {
    expect(whiteShare({ cp: 2000 })).toBe(96);
    expect(whiteShare({ cp: -2000 })).toBe(4);
    expect(whiteShare({ mate: 3 })).toBe(100);
    expect(whiteShare({ mate: -2 })).toBe(0);
  });
  it('Kurzform passt in den schmalen Balken', () => {
    expect(barLabel({ cp: 32 })).toBe('0,3');
    expect(barLabel({ cp: -145 })).toBe('1,4');
    expect(barLabel({ cp: 1234 })).toBe('12');
    expect(barLabel({ mate: -3 })).toBe('M3');
  });
});
