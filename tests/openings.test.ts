import { describe, it, expect } from 'vitest';
import { nameDe, termsDe } from '../src/core/openings';

describe('Eröffnungsnamen eindeutschen', () => {
  it('Familie und häufige Begriffe', () => {
    expect(nameDe('Ruy Lopez: Morphy Defense, Modern Steinitz Defense')).toBe('Spanisch: Morphy-Verteidigung, Modern Steinitz-Verteidigung');
    expect(termsDe(': Exchange Variation')).toBe(': Abtauschvariante');
    expect(termsDe(': Main Line')).toBe(': Hauptvariante');
    expect(termsDe(": O'Kelly Variation, Venice System")).toBe(": O'Kelly-Variante, Venice-System");
    expect(termsDe(': Queen’s Gambit Accepted')).toBe(': Queen’s-Gambit angenommen');
  });
});
