import { describe, it, expect } from 'vitest';
import { ratingFor, newSrs, Scheduler, isDue, knowledgeOf, trainingStats, dayKey } from '../src/core/srs';

const T = { easyMs: 4000, hardMs: 15000 };
const DAY = 86400_000;

describe('FSRS-Rating-Mapping (F5)', () => {
  it('falsch → Again', () => expect(ratingFor(false, 1000, T)).toBe(1));
  it('richtig > 15 s → Hard', () => expect(ratingFor(true, 15001, T)).toBe(2));
  it('richtig 4–15 s → Good', () => {
    expect(ratingFor(true, 4000, T)).toBe(3);
    expect(ratingFor(true, 15000, T)).toBe(3);
  });
  it('richtig < 4 s → Easy', () => expect(ratingFor(true, 3999, T)).toBe(4));
});

describe('Scheduler', () => {
  const now = Date.UTC(2026, 10, 7, 12);

  it('neue Karte ist nicht fällig und hat kein R', () => {
    const s = newSrs(now);
    const sch = new Scheduler(0.9);
    expect(s.state).toBe(0);
    expect(isDue(s, now)).toBe(false);
    expect(sch.retrievability(s, now)).toBeUndefined();
  });

  it('Good verschiebt die Fälligkeit in die Zukunft, Again setzt zurück', () => {
    const sch = new Scheduler(0.9);
    let s = newSrs(now);
    s = sch.review(s, 3, now);
    s = sch.review(s, 3, s.due);
    expect(s.due).toBeGreaterThan(now + DAY / 2);
    const before = s;
    const lapsed = sch.review(before, 1, before.due);
    expect(lapsed.lapses).toBe(before.lapses + 1);
    expect(lapsed.due).toBeLessThan(before.due + DAY);
    const r = sch.retrievability(s, s.due)!;
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(1);
  });

  it('Wissensfarben', () => {
    expect(knowledgeOf(undefined)).toBe('grey');
    expect(knowledgeOf(0.95)).toBe('green');
    expect(knowledgeOf(0.9)).toBe('green');
    expect(knowledgeOf(0.8)).toBe('yellow');
    expect(knowledgeOf(0.69)).toBe('red');
  });
});

describe('Statistik', () => {
  it('Serie, heute, Trefferquote', () => {
    const now = new Date(2026, 10, 7, 18).getTime();
    const logs = [
      { at: now - 1000, correct: true },
      { at: now - 2000, correct: false },
      { at: now - DAY, correct: true },
      { at: now - 2 * DAY, correct: true },
      { at: now - 10 * DAY, correct: false },
    ];
    const s = trainingStats(logs, now);
    expect(s.reviewsToday).toBe(2);
    expect(s.streak).toBe(3);
    expect(s.hitRate7).toBeCloseTo(3 / 4);
    expect(s.hitRate30).toBeCloseTo(3 / 5);
  });

  it('Serie zählt auch, wenn heute noch nicht trainiert', () => {
    const now = new Date(2026, 10, 7, 18).getTime();
    expect(trainingStats([{ at: now - DAY, correct: true }], now).streak).toBe(1);
    expect(trainingStats([{ at: now - 3 * DAY, correct: true }], now).streak).toBe(0);
  });

  it('Tageswechsel um 4 Uhr', () => {
    expect(dayKey(new Date(2026, 10, 7, 3).getTime())).toBe('2026-11-06');
    expect(dayKey(new Date(2026, 10, 7, 5).getTime())).toBe('2026-11-07');
  });
});
