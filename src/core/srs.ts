// FSRS-Anbindung (ts-fsrs 5) und automatische Bewertung (F5).
import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { FsrsRating, SrsState } from './types';

export function toFsrs(s: SrsState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review !== undefined ? new Date(s.last_review) : undefined,
  };
}

export function fromFsrs(c: FsrsCard): SrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : undefined,
  };
}

export function newSrs(now: number): SrsState {
  return fromFsrs(createEmptyCard(new Date(now)));
}

export interface RatingThresholds {
  easyMs: number; // schneller → Easy
  hardMs: number; // langsamer → Hard
}

/** Falsch → Again, richtig > hardMs → Hard, richtig < easyMs → Easy, sonst Good. */
export function ratingFor(correct: boolean, ms: number, t: RatingThresholds): FsrsRating {
  if (!correct) return 1;
  if (ms > t.hardMs) return 2;
  if (ms < t.easyMs) return 4;
  return 3;
}

export class Scheduler {
  private f;
  constructor(desiredRetention = 0.9) {
    this.f = fsrs(generatorParameters({ request_retention: desiredRetention, enable_fuzz: true, enable_short_term: true }));
  }

  review(s: SrsState, rating: FsrsRating, now: number): SrsState {
    return fromFsrs(this.f.next(toFsrs(s), new Date(now), rating as Grade).card);
  }

  /** Abrufwahrscheinlichkeit R (0..1); neue Karten → undefined. */
  retrievability(s: SrsState, now: number): number | undefined {
    if (s.state === 0) return undefined;
    return this.f.get_retrievability(toFsrs(s), new Date(now), false);
  }
}

export const isNew = (s: SrsState) => s.state === 0;
export const isDue = (s: SrsState, now: number) => s.state !== 0 && s.due <= now;

/** Wissens-Farbe (F4): grün ≥ 0,9 · gelb 0,7–0,9 · rot < 0,7 · grau neu. */
export type Knowledge = 'green' | 'yellow' | 'red' | 'grey';
export function knowledgeOf(r: number | undefined): Knowledge {
  if (r === undefined) return 'grey';
  if (r >= 0.9) return 'green';
  if (r >= 0.7) return 'yellow';
  return 'red';
}

/** Tagesgrenze (lokale Zeit, 4 Uhr wie Anki) für „heute gelernt“ und Serie. */
export function dayKey(ts: number, rolloverHour = 4): string {
  const d = new Date(ts - rolloverHour * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ReviewLite {
  at: number;
  correct: boolean;
}

export interface TrainingStats {
  reviewsToday: number;
  hitRate7?: number;
  hitRate30?: number;
  streak: number;
}

export function trainingStats(logs: ReviewLite[], now: number): TrainingStats {
  const today = dayKey(now);
  const days = new Set(logs.map((l) => dayKey(l.at)));
  const rate = (ms: number) => {
    const sel = logs.filter((l) => l.at >= now - ms);
    return sel.length ? sel.filter((l) => l.correct).length / sel.length : undefined;
  };
  // Serie: Tage in Folge mit ≥ 1 Wiederholung, endend heute oder gestern
  let streak = 0;
  let t = now;
  if (!days.has(today)) t -= 86400_000;
  while (days.has(dayKey(t))) {
    streak++;
    t -= 86400_000;
  }
  return {
    reviewsToday: logs.filter((l) => dayKey(l.at) === today).length,
    hitRate7: rate(7 * 86400_000),
    hitRate30: rate(30 * 86400_000),
    streak,
  };
}
