// PGN-Import (F9) mit Konflikterkennung und PGN-Export.
import { parsePgn, parseComment, startingPosition, makePgn, ChildNode, Node, type Game, type PgnNodeData } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import { fenOf, posKeyOf, positionFromFen, stdUci, turnOf, START_FEN } from './chess';
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
  errors: string[];
}

interface WalkCtx {
  fen: string;
  sans: string[];
}

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
        const p = positionFromFen(ctx.fen);
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
        if (go) rec(child, { fen: fenAfter, sans: [...ctx.sans, san] });
      }
    };
    rec(game.moves, { fen: fenOf(start.value), sans: [] });
  });
}

export function readPgn(text: string): Game<PgnNodeData>[] {
  return parsePgn(text.replace(/^﻿/, ''));
}

/** Kapitel für eine Repertoire-Farbe: Kapitel mit Orientation der anderen Farbe fallen weg (z. B. gemischte Lichess-Studien). */
function gamesFor(text: string, color: Color): { games: Game<PgnNodeData>[]; otherColor: number } {
  const all = readPgn(text);
  const games = all.filter((g) => {
    const o = g.headers.get('Orientation')?.toLowerCase();
    return o !== 'white' && o !== 'black' ? true : o === color;
  });
  return { games, otherColor: all.length - games.length };
}

/** Schritt 1: Konflikte finden (zwei verschiedene eigene Züge in derselben Stellung). */
export function analyzePgn(text: string, color: Color, existing: Map<string, ExistingEntry>): ImportAnalysis {
  const { games, otherColor } = gamesFor(text, color);
  const errors: string[] = [];
  const seen = new Map<string, { fen: string; sans: string[]; moves: { uci: string; san: string }[] }>();
  walkGames(games, errors, (ctx, _data, mv) => {
    if (turnOf(ctx.fen) !== color) return true;
    const key = posKeyOf(ctx.fen);
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
): ImportPlan {
  const { games } = gamesFor(text, color);
  const errors: string[] = [];
  const entries = new Map<string, PlannedEntry>();
  const marks = new Map<string, PlannedMark>();
  const firstSeen = new Map<string, string>();
  let skipped = 0;
  const conflictKeys = new Set(analyzePgn(text, color, existing).conflicts.map((c) => c.posKey));

  const markOf = (posKey: string) => {
    let m = marks.get(posKey);
    if (!m) {
      m = { posKey, extraOppMoves: [] };
      marks.set(posKey, m);
    }
    return m;
  };

  walkGames(games, errors, (ctx, data, mv) => {
    const key = posKeyOf(ctx.fen);
    const parsed = parseRepComment(commentText(data));
    const afterKey = posKeyOf(mv.fenAfter);
    if (turnOf(ctx.fen) === color) {
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
    errors,
  };
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
export function mainlineSans(text: string): string[] {
  const games = readPgn(text);
  return games.length ? [...games[0].moves.mainline()].map((d) => d.san) : [];
}
