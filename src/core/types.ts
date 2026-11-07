// Datenmodell (Pflichtenheft 4.2). Reine Typen, keine Logik.

export type Color = 'white' | 'black';
export type Side = 'me' | 'opp';

export interface Repertoire {
  id: string;
  name: string;
  color: Color;
  isMain: boolean; // genau ein Hauptrepertoire pro Farbe
  createdAt: number;
  updatedAt: number;
}

/** "In Stellung X spiele ich Y." Pro Repertoire und Stellung höchstens einer. */
export interface RepertoireMove {
  id: string;
  repertoireId: string;
  posKey: string;
  fen: string;
  uci: string; // Standard-UCI (Rochade e1g1, nicht e1h1)
  san: string;
  note?: string;
  links?: string[];
  tags?: string[];
  source: 'manual' | 'pgn' | 'seed';
  createdAt: number;
  updatedAt: number;
}

export interface PositionMark {
  repertoireId: string;
  posKey: string;
  endOfLine?: boolean;
  ignoredOppMoves?: string[];
  extraOppMoves?: string[];
  /** Eigener Name der Stellung (z. B. „Najdorf“), aus PGN-Kommentaren oder vom Nutzer. */
  label?: string;
  /** Notiz zu einer Stellung, in der der Gegner gerade gezogen hat (z. B. Studienkommentar). */
  note?: string;
  updatedAt: number;
}

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}

export interface ExplorerData {
  key: string; // posKey|source|speeds|ratings
  posKey: string;
  moves: ExplorerMove[];
  total: number;
  opening?: { eco: string; name: string };
  fetchedAt: number;
}

export interface EngineLine {
  uci: string;
  san: string;
  /** Bewertung aus Sicht der Seite am Zug (UCI-Konvention). */
  cp?: number;
  mate?: number;
  pv: string[];
}

export interface EngineData {
  posKey: string;
  depth: number;
  lines: EngineLine[];
  analysedAt: number;
}

/** FSRS-Zustand als reine Zahlen (Datum in ms) – JSON- und Sync-tauglich. */
export interface SrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review?: number;
}

export interface Card {
  id: string;
  repertoireId: string;
  posKey: string;
  uci: string; // der Zug, auf den sich die Lernhistorie bezieht
  srs: SrsState;
  suspended?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type FsrsRating = 1 | 2 | 3 | 4;

export interface ReviewLog {
  id?: number;
  cardId: string;
  repertoireId: string;
  posKey: string;
  at: number;
  rating: FsrsRating;
  correct: boolean;
  msToAnswer: number;
  wrongMoveUci?: string;
  mode: TrainingMode;
}

export type TrainingMode = 'due' | 'new' | 'line';

export interface Settings {
  id: 'settings';
  explorer: {
    speeds: string[];
    ratings: number[];
    token?: string;
    minShare: number; // 0..1
    minGames: number;
  };
  engine: { depth: number; multipv: number; nearBestCp: number; trapLossCp: number; trapMinShare: number };
  srs: {
    desiredRetention: number;
    newPerDay: number;
    maxReviewsPerDay: number;
    contextPlies: number;
    easyMs: number; // < easyMs → Easy
    hardMs: number; // > hardMs → Hard
  };
  ui: { notation: 'de' | 'en'; showReach: boolean; showTraps: boolean; structuresLink?: string };
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  explorer: { speeds: ['rapid', 'classical'], ratings: [1800, 2000], minShare: 0.05, minGames: 20 },
  engine: { depth: 18, multipv: 5, nearBestCp: 50, trapLossCp: 100, trapMinShare: 0.1 },
  srs: { desiredRetention: 0.9, newPerDay: 10, maxReviewsPerDay: 200, contextPlies: 4, easyMs: 4000, hardMs: 15000 },
  ui: { notation: 'de', showReach: true, showTraps: true },
  updatedAt: 0,
};
