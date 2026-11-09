// PGN-Import (F9) mit Konflikterkennung und PGN-Export.
import { parsePgn, parseComment, startingPosition, makePgn, ChildNode, Node, type Game, type PgnNodeData } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import type { Position } from 'chessops/chess';
import { fenOf, stdUci, turnOf, START_FEN } from './chess';
import type { Color } from './types';
import type { Graph } from './graph';

// ---------------------------------------------------------------- Kommentare

export interface ParsedComment {
  label?: string;
  note?: string;
  tags: string[];
}

const DEPTH_TAGS = ['tief', 'mittel', 'flach'];

/**
 * Seed-/Studienkommentare: "Name | Tiefe: tief | Status: … | Pläne …".
 * - „LÜCKE: …“ wird ignoriert (die Lückenlogik findet Lücken selbst).
 * - „Tiefe: x“ → Tag x; „Status: … festlegen“ → Tag „prüfen“.
 * - Erstes kurzes Segment ohne Satzende → Label (Name der Stellung), Rest → Notiz.
 */
export function parseRepComment(raw: string): ParsedComment {
  const text = parseComment(raw).text.replace(/\s+/g, ' ').trim();
  const tags: string[] = [];
  const rest: string[] = [];
  for (const segRaw of text.split(/\s+\|\s+/)) {
    const seg = segRaw.trim();
    if (!seg) continue;
    if (/^LÜCKE\b/i.test(seg)) continue;
    const tm = /^Tiefe:\s*(\S+)/i.exec(seg);
    if (tm) {
      const t = tm[1].toLowerCase();
      if (DEPTH_TAGS.includes(t)) tags.push(t);
      continue;
    }
    const sm = /^Status:\s*(.*)$/i.exec(seg);
    if (sm) {
      if (/festlegen/i.test(sm[1])) tags.push('prüfen');
      continue;
    }
    rest.push(seg);
  }
  let label: string | undefined;
  if (rest.length && rest[0].length <= 48 && !/[.!?:]$/.test(rest[0]) && (rest.length > 1 || rest[0].length <= 40)) {
    label = rest.shift();
  }
  const note = rest.length ? rest.join(' · ') : undefined;
  return { label, note, tags };
}

function commentText(data: PgnNodeData): string {
  return (data.comments ?? []).join(' ').trim();
}

// ---------------------------------------------------------------- Import

export interface ExistingEntry {
  uci: string;
  san: string;
  note?: string;
  tags?: string[];
}

export interface ImportConflict {
  posKey: string;
  fen: string;
  sans: string[]; // Weg (SAN) bis zur Stellung, erste Fundstelle
  options: { uci: string; san: string; source: 'existing' | 'pgn' }[];
  defaultUci: string;
}

export interface ImportAnalysis {
  games: number;
  /** Kapitel, deren Orientation-Header die andere Farbe nennt – werden nicht importiert. */
  otherColor: number;
  conflicts: ImportConflict[];
  errors: string[];
}

export interface PlannedEntry {
  posKey: string;
  fen: string;
  uci: string;
  san: string;
  note?: string;
  tags: string[];
  status: 'new' | 'update' | 'unchanged' | 'replace';
}

export interface PlannedMark {
  posKey: string;
  extraOppMoves: string[];
  label?: string;
  note?: string;
}

export interface ImportPlan {
  entries: PlannedEntry[];
  marks: PlannedMark[];
  stats: { newEntries: number; existing: number; replaced: number; conflicts: number; skipped: number; games: number };
  /** Konfliktstellungen, die mit der aktuellen Auswahl erreicht werden – nur diese muss man entscheiden. */
  reachedConflicts: Set<string>;
  errors: string[];
}

interface WalkCtx {
  fen: string;
  sans: string[];
  /** Stellung zu fen – mitgeführt, damit nicht jeder Zug die FEN neu parsen muss. */
  pos: Position;
}

/** posKey aus einer FEN, die fenOf() erzeugt hat (ep ist dort schon nur gesetzt, wenn legal) – ohne erneutes Parsen. */
const keyOfFen = (fen: string) => fen.split(' ', 4).join(' ');

type Visitor = (ctx: WalkCtx, data: PgnNodeData, move: { uci: string; san: string; fenAfter: string }) => boolean;

/** Tiefensuche über alle Spiele, Hauptvariante zuerst. Visitor gibt false zurück → Ast überspringen. */
function walkGames(games: Game<PgnNodeData>[], errors: string[], visit: Visitor) {
  games.forEach((game, gi) => {
    const start = startingPosition(game.headers);
    if (start.isErr) {
      errors.push(`Kapitel ${gi + 1}: ungültige Startstellung`);
      return;
    }
    const rec = (node: Node<PgnNodeData>, ctx: WalkCtx) => {
      for (const child of node.children) {
        const p = ctx.pos.clone();
        const move = parseSan(p, child.data.san);
        if (!move || !('from' in move)) {
          errors.push(`Kapitel ${gi + 1} „${game.headers.get('Event') ?? ''}“: ungültiger Zug ${child.data.san} nach ${ctx.sans.join(' ') || 'Start'}`);
          continue;
        }
        const san = makeSan(p, move);
        const uci = stdUci(p, move);
        p.play(move);
        const fenAfter = fenOf(p);
        const go = visit(ctx, child.data, { uci, san, fenAfter });
        if (go) rec(child, { fen: fenAfter, sans: [...ctx.sans, san], pos: p });
      }
    };
    rec(game.moves, { fen: fenOf(start.value), sans: [], pos: start.value });
  });
}

export function readPgn(text: string): Game<PgnNodeData>[] {
  return parsePgn(text.replace(/^﻿/, ''));
}

/** Bearbeitung einer Studie vor der Übernahme: entfernte Züge (Ast ab dort) und abgewählte Kapitel. */
export interface StudyFilter {
  /** `${posKey} ${uci}` – dieser Zug samt allem dahinter wird nicht übernommen. */
  cuts?: Set<string>;
  /** Kapitel-Indizes (Reihenfolge im PGN), die nicht übernommen werden. */
  skipChapters?: Set<number>;
}

export const cutKey = (posKey: string, uci: string) => `${posKey} ${uci}`;

/** Farbe eines Kapitels laut Orientation-Header (sonst undefined). */
function chapterColor(g: Game<PgnNodeData>): Color | undefined {
  const o = g.headers.get('Orientation')?.toLowerCase();
  return o === 'white' || o === 'black' ? o : undefined;
}

/** Kapitel für eine Repertoire-Farbe: Kapitel mit Orientation der anderen Farbe fallen weg (z. B. gemischte Lichess-Studien). */
function gamesFor(text: string, color: Color, filter?: StudyFilter): { games: Game<PgnNodeData>[]; otherColor: number } {
  const all = readPgn(text);
  let otherColor = 0;
  const games = all.filter((g, i) => {
    const c = chapterColor(g);
    if (c && c !== color) {
      otherColor++;
      return false;
    }
    return !filter?.skipChapters?.has(i);
  });
  return { games, otherColor };
}

/** Schritt 1: Konflikte finden (zwei verschiedene eigene Züge in derselben Stellung). */
export function analyzePgn(text: string, color: Color, existing: Map<string, ExistingEntry>, filter?: StudyFilter): ImportAnalysis {
  const { games, otherColor } = gamesFor(text, color, filter);
  const errors: string[] = [];
  const seen = new Map<string, { fen: string; sans: string[]; moves: { uci: string; san: string }[] }>();
  walkGames(games, errors, (ctx, _data, mv) => {
    if (filter?.cuts?.has(cutKey(keyOfFen(ctx.fen), mv.uci))) return false;
    if (turnOf(ctx.fen) !== color) return true;
    const key = keyOfFen(ctx.fen);
    const s = seen.get(key) ?? { fen: ctx.fen, sans: ctx.sans, moves: [] };
    if (!s.moves.some((m) => m.uci === mv.uci)) s.moves.push({ uci: mv.uci, san: mv.san });
    seen.set(key, s);
    return true;
  });
  const conflicts: ImportConflict[] = [];
  for (const [posKey, s] of seen) {
    const ex = existing.get(posKey);
    const options: ImportConflict['options'] = [];
    if (ex) options.push({ uci: ex.uci, san: ex.san, source: 'existing' });
    for (const m of s.moves) if (!options.some((o) => o.uci === m.uci)) options.push({ ...m, source: 'pgn' });
    if (options.length > 1) {
      // Standard: vorhandener Eintrag (nichts ohne Rückfrage überschreiben), sonst Hauptvariante der PGN
      conflicts.push({ posKey, fen: s.fen, sans: s.sans, options, defaultUci: options[0].uci });
    }
  }
  return { games: games.length, otherColor, conflicts, errors };
}

/** Schritt 2: Importplan mit gewählten Auflösungen (posKey → gewählter UCI). */
export function planImport(
  text: string,
  color: Color,
  existing: Map<string, ExistingEntry>,
  resolutions: Map<string, string> = new Map(),
  /** Schon berechnete Analyse (spart einen zweiten Durchlauf). */
  analysis?: ImportAnalysis,
  filter?: StudyFilter,
): ImportPlan {
  const { games } = gamesFor(text, color, filter);
  const errors: string[] = [];
  const entries = new Map<string, PlannedEntry>();
  const marks = new Map<string, PlannedMark>();
  const firstSeen = new Map<string, string>();
  let skipped = 0;
  const conflictKeys = new Set((analysis ?? analyzePgn(text, color, existing, filter)).conflicts.map((c) => c.posKey));
  /** Konfliktstellungen, die mit den gewählten Zügen tatsächlich erreicht werden (Rest liegt in übersprungenen Ästen). */
  const reached = new Set<string>();

  const markOf = (posKey: string) => {
    let m = marks.get(posKey);
    if (!m) {
      m = { posKey, extraOppMoves: [] };
      marks.set(posKey, m);
    }
    return m;
  };

  walkGames(games, errors, (ctx, data, mv) => {
    const key = keyOfFen(ctx.fen);
    if (filter?.cuts?.has(cutKey(key, mv.uci))) {
      skipped++;
      return false; // vom Nutzer entfernter Ast
    }
    const parsed = parseRepComment(commentText(data));
    const afterKey = keyOfFen(mv.fenAfter);
    if (turnOf(ctx.fen) === color) {
      if (conflictKeys.has(key)) reached.add(key);
      const ex = existing.get(key);
      const chosen = resolutions.get(key) ?? ex?.uci ?? firstSeen.get(key) ?? mv.uci;
      if (!firstSeen.has(key)) firstSeen.set(key, chosen);
      if (mv.uci !== chosen) {
        skipped++;
        return false; // Ast des verworfenen Zugs überspringen
      }
      let e = entries.get(key);
      if (!e) {
        const status: PlannedEntry['status'] = !ex ? 'new' : ex.uci === mv.uci ? 'unchanged' : 'replace';
        e = { posKey: key, fen: ctx.fen, uci: mv.uci, san: mv.san, tags: [], status };
        if (ex && ex.uci === mv.uci) {
          e.note = ex.note;
          e.tags = [...(ex.tags ?? [])];
        }
        entries.set(key, e);
      }
      if (parsed.note && !(e.note ?? '').includes(parsed.note)) {
        e.note = e.note ? `${e.note}\n\n${parsed.note}` : parsed.note;
        if (e.status === 'unchanged') e.status = 'update';
      }
      for (const t of parsed.tags) {
        if (!e.tags.includes(t)) {
          e.tags.push(t);
          if (e.status === 'unchanged') e.status = 'update';
        }
      }
      if (parsed.label) {
        const m = markOf(afterKey);
        m.label ??= parsed.label;
      }
    } else {
      const m = markOf(key);
      if (!m.extraOppMoves.includes(mv.uci)) m.extraOppMoves.push(mv.uci);
      if (parsed.label || parsed.note) {
        const am = markOf(afterKey);
        if (parsed.label) am.label ??= parsed.label;
        if (parsed.note && !(am.note ?? '').includes(parsed.note)) am.note = am.note ? `${am.note}\n\n${parsed.note}` : parsed.note;
      }
    }
    return true;
  });

  const list = [...entries.values()];
  return {
    entries: list,
    marks: [...marks.values()].filter((m) => m.extraOppMoves.length || m.label || m.note),
    stats: {
      newEntries: list.filter((e) => e.status === 'new').length,
      existing: list.filter((e) => e.status === 'unchanged' || e.status === 'update').length,
      replaced: list.filter((e) => e.status === 'replace').length,
      conflicts: conflictKeys.size,
      skipped,
      games: games.length,
    },
    reachedConflicts: reached,
    errors,
  };
}

/**
 * Farbe einer Repertoire-Studie ohne Orientation-Header schätzen (Lichess lässt ihn oft weg):
 * Im Repertoire verzweigt der Gegner (viele Antworten), die eigene Seite kaum (ein Zug pro Stellung).
 * → die Seite mit deutlich weniger Verzweigungsstellen ist die Repertoire-Farbe. Unklar → undefined.
 */
export function guessColor(text: string): Color | undefined {
  const moves = { white: new Map<string, Set<string>>(), black: new Map<string, Set<string>>() };
  walkGames(readPgn(text), [], (ctx, _data, mv) => {
    const side = turnOf(ctx.fen);
    const key = keyOfFen(ctx.fen);
    const set = moves[side].get(key) ?? new Set<string>();
    set.add(mv.uci);
    moves[side].set(key, set);
    return true;
  });
  const branches = (m: Map<string, Set<string>>) => [...m.values()].filter((x) => x.size > 1).length;
  const w = branches(moves.white);
  const b = branches(moves.black);
  if (Math.max(w, b) < 2) return undefined;
  if (w >= 2 * b + 1) return 'black';
  if (b >= 2 * w + 1) return 'white';
  return undefined;
}

/** Orientierung aus dem PGN-Header (für die Vorauswahl der Farbe). */
export function pgnOrientation(text: string): Color | undefined {
  const m = /\[Orientation\s+"(white|black)"\]/i.exec(text);
  return m ? (m[1].toLowerCase() as Color) : undefined;
}

// ---------------------------------------------------------------- Export

export interface ExportOptions {
  name: string;
  notes: Map<string, string | undefined>; // posKey (vor meinem Zug) → Notiz
  labels: Map<string, string | undefined>; // posKey (nach dem Zug) → Label
  extraOpp: Map<string, string[]>; // posKey → extraOppMoves
  maxNodes?: number;
}

/**
 * PGN mit Varianten aus dem ausgerollten Graphen. Zugumstellungen werden dupliziert
 * (Lichess-Studien kennen keine Verweise); Zyklen werden abgebrochen.
 * Gegnerzüge, die nur zu Lücken führen, werden weggelassen (außer sie sind ausdrücklich markiert).
 */
export function exportPgn(g: Graph, opts: ExportOptions): string {
  const maxNodes = opts.maxNodes ?? 20000;
  let count = 0;
  const hasAnswerBelow = new Map<number, boolean>();
  const answerBelow = (id: number, stack = new Set<number>()): boolean => {
    const n = g.nodes[id];
    const canon = n.status === 'transposition' ? n.transposeOf! : id;
    if (hasAnswerBelow.has(canon)) return hasAnswerBelow.get(canon)!;
    if (stack.has(canon)) return false;
    stack.add(canon);
    const cn = g.nodes[canon];
    const v = cn.status === 'answered' || cn.status === 'end' || cn.children.some((c) => answerBelow(c, stack));
    hasAnswerBelow.set(canon, v);
    return v;
  };

  const build = (id: number, into: Node<PgnNodeData>, path: Set<string>) => {
    const n0 = g.nodes[id];
    const n = n0.status === 'transposition' ? g.nodes[n0.transposeOf!] : n0;
    if (path.has(n.posKey)) return;
    const nextPath = new Set(path).add(n.posKey);
    for (const cid of n.children) {
      if (count >= maxNodes) return;
      const c = g.nodes[cid];
      if (c.by === 'opp') {
        const extra = opts.extraOpp.get(n.posKey)?.includes(c.uci!) ?? false;
        if (!extra && !answerBelow(cid)) continue;
      }
      const comments: string[] = [];
      const label = opts.labels.get(c.posKey);
      if (label) comments.push(label);
      if (c.by === 'me') {
        const note = opts.notes.get(n.posKey);
        if (note) comments.push(note.replace(/[{}]/g, ''));
      }
      const child = new ChildNode<PgnNodeData>({ san: c.san!, comments: comments.length ? [comments.join(' | ')] : undefined });
      into.children.push(child);
      count++;
      build(cid, child, nextPath);
    }
  };

  const root = new Node<PgnNodeData>();
  build(0, root, new Set());
  const headers = new Map<string, string>([
    ['Event', opts.name],
    ['Site', 'RepLab'],
    ['Result', '*'],
    ['Orientation', g.color],
  ]);
  if (g.nodes[0].fen !== START_FEN) {
    headers.set('SetUp', '1');
    headers.set('FEN', g.nodes[0].fen);
  }
  return makePgn({ headers, moves: root });
}

/** Hilfsfunktion für Tests: SAN-Hauptlinie einer PGN-Partie. */
/** Gemeinsamer Anfang der Hauptvarianten aller Kapitel (UCI) – dorthin springt die Ansicht nach dem Import. */
export function studyStart(text: string, color: Color): string[] {
  let common: string[] | undefined;
  for (const game of gamesFor(text, color).games) {
    const start = startingPosition(game.headers);
    if (start.isErr) continue;
    const pos = start.value;
    if (fenOf(pos) !== START_FEN) return []; // eigene Startstellung: kein gemeinsamer Weg ab der Grundstellung
    const ucis: string[] = [];
    for (const d of game.moves.mainline()) {
      const mv = parseSan(pos, d.san);
      if (!mv) break;
      ucis.push(stdUci(pos, mv));
      pos.play(mv);
    }
    if (!ucis.length) continue; // reines Textkapitel
    common = common ? common.slice(0, commonLen(common, ucis)) : ucis;
  }
  return common ?? [];
}

function commonLen(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function mainlineSans(text: string): string[] {
  const games = readPgn(text);
  return games.length ? [...games[0].moves.mainline()].map((d) => d.san) : [];
}

// ---------------------------------------------------------------- Studienbaum (Studien-Reiter)

export interface StudyMove {
  uci: string;
  san: string;
  /** posKey nach dem Zug */
  child: string;
  /** Kapitel (Indizes), in denen der Zug vorkommt */
  chapters: number[];
  /** Kommentar(e) zum Zug, ohne Pfeil-/Feldmarkierungen */
  comment?: string;
}

export interface StudyNode {
  key: string;
  fen: string;
  moves: StudyMove[];
}

export interface StudyChapter {
  index: number;
  name: string;
  /** Hauptvariante des Kapitels als UCI-Züge ab der Grundstellung */
  mainline: string[];
  /** Farbe laut Orientation-Header; undefined = unbekannt */
  color?: Color;
  /** Einleitungstext des Kapitels */
  intro?: string;
}

export interface StudyTree {
  root: string;
  nodes: Map<string, StudyNode>;
  chapters: StudyChapter[];
}

const cleanComment = (raw: string) => parseComment(raw).text.replace(/\s+/g, ' ').trim();

/**
 * Alle Kapitel als ein Baum, Stellungen über posKey zusammengeführt (Zugumstellungen fallen zusammen).
 * Kapitel der anderen Farbe sind enthalten, aber markiert (chapters[i].color) – die Ansicht blendet sie aus.
 */
export function buildStudyTree(text: string): StudyTree {
  const all = readPgn(text);
  const nodes = new Map<string, StudyNode>();
  const chapters: StudyChapter[] = all.map((g, i) => {
    const intro = (g.comments ?? []).map(cleanComment).filter(Boolean).join(' ');
    const mainline: string[] = [];
    const start = startingPosition(g.headers);
    if (start.isOk) {
      const pos = start.value;
      for (const d of g.moves.mainline()) {
        const mv = parseSan(pos, d.san);
        if (!mv) break;
        mainline.push(stdUci(pos, mv));
        pos.play(mv);
      }
    }
    return {
      index: i,
      name: g.headers.get('ChapterName') || g.headers.get('Event') || `Kapitel ${i + 1}`,
      mainline,
      color: chapterColor(g),
      intro: intro || undefined,
    };
  });
  const nodeOf = (fen: string) => {
    const key = keyOfFen(fen);
    let n = nodes.get(key);
    if (!n) {
      n = { key, fen, moves: [] };
      nodes.set(key, n);
    }
    return n;
  };
  let root = keyOfFen(START_FEN);
  all.forEach((game, gi) => {
    const start = startingPosition(game.headers);
    if (start.isErr) return;
    const startFen = fenOf(start.value);
    if (gi === 0) root = keyOfFen(startFen);
    nodeOf(startFen);
    walkGames([game], [], (ctx, data, mv) => {
      const n = nodeOf(ctx.fen);
      nodeOf(mv.fenAfter);
      let m = n.moves.find((x) => x.uci === mv.uci);
      if (!m) {
        m = { uci: mv.uci, san: mv.san, child: keyOfFen(mv.fenAfter), chapters: [] };
        n.moves.push(m);
      }
      if (!m.chapters.includes(gi)) m.chapters.push(gi);
      const c = (data.comments ?? []).map(cleanComment).filter(Boolean).join(' ');
      if (c && !(m.comment ?? '').includes(c)) m.comment = m.comment ? `${m.comment} · ${c}` : c;
      return true;
    });
  });
  return { root, nodes, chapters };
}

