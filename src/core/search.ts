// Suche im Repertoire-Baum: Eröffnungsname, eigener Stellungsname, Notiz oder Zugfolge (deutsch oder englisch).
// UI-frei und getestet. Ergebnis: Knoten-IDs, sortiert nach Wichtigkeit (flach vor tief, dann Erreichbarkeit).
import type { Graph } from './graph';
import { displaySan } from './chess';

export type HitKind = 'line' | 'name' | 'label' | 'note';

export interface SearchHit {
  id: number;
  kind: HitKind;
  /** passender Text (Name, Notiz-Ausschnitt) – bei Zugfolgen leer */
  text?: string;
}

const DE_TO_EN: Record<string, string> = { S: 'N', L: 'B', T: 'R', D: 'Q', K: 'K' };

/** Ein SAN-Token aus der Eingabe auf englische SAN normalisieren (S→N, L→B, T→R, D→Q, ohne +/#/!/?). */
export function normalizeSanToken(t: string): string {
  let s = t.trim().replace(/[+#!?]+$/g, '');
  s = s.replace(/^\d+\.(\.\.)?|^\d+…/, ''); // Zugnummer „3.“, „3…“, „3...“
  if (!s) return '';
  if (DE_TO_EN[s[0]] && s.length > 1) s = DE_TO_EN[s[0]] + s.slice(1);
  s = s.replace(/=([SLTD])$/, (_, p: string) => '=' + DE_TO_EN[p]);
  s = s.replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O');
  return s;
}

/** Sieht die Eingabe wie eine Zugfolge aus? (z. B. „Lb5 e5“, „3.Lb5“, „e4 c5 Nf3“) */
export function looksLikeMoves(q: string): boolean {
  const toks = q.trim().split(/\s+/).map(normalizeSanToken).filter(Boolean);
  return toks.length > 0 && toks.every((t) => /^([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?|O-O(-O)?)$/.test(t));
}

export interface SearchInput {
  notes?: Map<string, string>; // posKey → Notiz
  labels?: Map<string, string>; // posKey → eigener Stellungsname
  limit?: number;
}

export function searchGraph(g: Graph, query: string, input: SearchInput = {}): SearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const limit = input.limit ?? 40;
  const lower = q.toLowerCase();
  const hits = new Map<number, SearchHit>();
  const add = (id: number, hit: SearchHit) => {
    if (!hits.has(id)) hits.set(id, hit);
  };
  const usable = (id: number) => g.nodes[id].status !== 'transposition';

  // 1) Zugfolge: Knoten, deren Weg mit diesen Zügen endet (die Stellung nach der Eingabe)
  if (looksLikeMoves(q)) {
    const toks = q.split(/\s+/).map(normalizeSanToken).filter(Boolean);
    for (const n of g.nodes) {
      if (!usable(n.id) || n.ply < toks.length) continue;
      let ok = true;
      let c = n.id;
      for (let i = toks.length - 1; i >= 0 && ok; i--) {
        const node = g.nodes[c];
        if (!node.san || stripSan(node.san) !== toks[i]) ok = false;
        c = node.parent;
      }
      if (ok) add(n.id, { id: n.id, kind: 'line' });
    }
  }

  // 2) Eigener Stellungsname
  if (input.labels) {
    for (const [posKey, label] of input.labels) {
      if (!label.toLowerCase().includes(lower)) continue;
      const id = g.byPosKey.get(posKey);
      if (id !== undefined && usable(id)) add(id, { id, kind: 'label', text: label });
    }
  }

  // 3) Eröffnungsname: je Name nur die flachste Stellung (sonst 200× „Sizilianisch“)
  const byName = new Map<string, number>();
  for (const n of g.nodes) {
    if (!n.name || !usable(n.id) || !n.name.toLowerCase().includes(lower)) continue;
    const cur = byName.get(n.name);
    if (cur === undefined || g.nodes[cur].ply > n.ply) byName.set(n.name, n.id);
  }
  for (const [name, id] of byName) add(id, { id, kind: 'name', text: name });

  // 4) Notizen
  if (input.notes) {
    for (const [posKey, note] of input.notes) {
      const i = note.toLowerCase().indexOf(lower);
      if (i < 0) continue;
      const id = g.byPosKey.get(posKey);
      if (id === undefined || !usable(id)) continue;
      const from = Math.max(0, i - 30);
      add(id, { id, kind: 'note', text: (from > 0 ? '…' : '') + note.slice(from, i + q.length + 50).trim() });
    }
  }

  const order: Record<HitKind, number> = { line: 0, label: 1, name: 2, note: 3 };
  return [...hits.values()]
    .sort((a, b) => order[a.kind] - order[b.kind] || g.nodes[a.id].ply - g.nodes[b.id].ply || g.nodes[b.id].reach - g.nodes[a.id].reach)
    .slice(0, limit);
}

const stripSan = (san: string) => san.replace(/[+#!?]+$/g, '');

/** Kurzform eines Wegs für die Trefferliste: letzte Züge mit Nummern. */
export function lineLabel(g: Graph, id: number, notation: 'de' | 'en', maxPlies = 8): string {
  const sans: { san: string; ply: number }[] = [];
  for (let c = id; c > 0; c = g.nodes[c].parent) sans.unshift({ san: g.nodes[c].san!, ply: g.nodes[c].ply - 1 });
  const shown = sans.slice(-maxPlies);
  return (
    (sans.length > shown.length ? '… ' : '') +
    shown
      .map((s, i) => {
        const num = s.ply % 2 === 0 ? `${Math.floor(s.ply / 2) + 1}.` : i === 0 ? `${Math.floor(s.ply / 2) + 1}…` : '';
        return num + displaySan(s.san, notation);
      })
      .join(' ')
  );
}
