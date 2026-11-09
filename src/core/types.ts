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
  key: string; // posKey|sig
  sig?: string; // source|speeds|ratings – zum Laden aller Einträge einer Parameterkombination
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

/**
 * Studie im Studien-Reiter: Original-PGN bleibt unverändert, Bearbeitungen liegen daneben.
 * Erst „Zum Repertoire hinzufügen“ erzeugt Einträge und Karten. Im Sync und in der JSON-Sicherung enthalten.
 */
export interface Study {
  id: string;
  name: string;
  color: Color;
  pgn: string;
  source?: string; // z. B. Lichess-Link
  /** gewählter eigener Zug je Stellung (posKey → uci), wo die Studie mehrere hat */
  choices: Record<string, string>;
  /** entfernte Züge `${posKey} ${uci}` (Ast ab dort) */
  cuts: string[];
  /** abgewählte Kapitel (Index im PGN) */
  skipChapters: number[];
  added?: { repertoireId: string; at: number; entries: number }[];
  /** angesehene Stellungen (posKeys) – Fortschritt beim Durcharbeiten */
  seen?: string[];
  /** zuletzt angesehene Stellung als Zugweg – dort geht es beim nächsten Öffnen weiter */
  lastPath?: { key: string; uci: string }[];
  /** Lernmodus: als verstanden markierte Linien (Linien-IDs, siehe core/studyLines.ts) */
  linesDone?: string[];
  /** Lernmodus: an/aus (fehlt = an), aktuelle Linie + Schritt, Reihenfolge, eigene Züge selbst spielen */
  learn?: {
    on?: boolean;
    line: string;
    step: number;
    order?: 'skeleton' | 'study';
    selfPlay?: boolean;
    /** Verlauf für „Zurück“ über Liniengrenzen (zuletzt besuchte Positionen, max. 30) */
    back?: { line: string; step: number }[];
  };
  createdAt: number;
  updatedAt: number;
}

export interface ReviewLog {
  id?: number; // lokale laufende Nummer (IndexedDB)
  uid?: string; // geräteübergreifende ID (Sync)
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
    /** Reihenfolge neuer Karten: wichtigste (Erreichbarkeit) zuerst oder Linie für Linie. */
    newOrder: 'reach' | 'line';
    /** Neue Karten erst ab dieser Erreichbarkeit einführen (0 = alle) – gegen 1000 neue Stellungen nach Importen. */
    newMinReach: number;
  };
  ui: {
    notation: 'de' | 'en';
    showReach: boolean;
    showTraps: boolean;
    structuresLink?: string;
    /** Lücken ab dieser Erreichbarkeit gelten als „wichtig“ (Hauptzahl, Standardfilter, Lückentour); seltenere bleiben sichtbar */
    gapMinReach: number;
    /** Bewertungsbalken (Stockfish) neben dem Brett beim Bauen und in Studien; fehlt = an */
    evalBar?: boolean;
  };
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  explorer: { speeds: ['rapid', 'classical'], ratings: [1800, 2000], minShare: 0.05, minGames: 20 },
  engine: { depth: 18, multipv: 5, nearBestCp: 50, trapLossCp: 100, trapMinShare: 0.1 },
  srs: { desiredRetention: 0.9, newPerDay: 10, maxReviewsPerDay: 200, contextPlies: 4, easyMs: 4000, hardMs: 15000, newOrder: 'reach', newMinReach: 0 },
  ui: { notation: 'de', showReach: true, showTraps: true, gapMinReach: 0.005 },
  updatedAt: 0,
};
