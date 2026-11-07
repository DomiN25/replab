// Download-Helfer für JSON-Sicherung und PGN-Export.
import { repo } from '../data/repo';
import { exportPgn } from '../core/pgn';
import type { Graph } from '../core/graph';
import type { PositionMark, Repertoire, RepertoireMove } from '../core/types';

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function lastBackupAt(): number {
  try {
    return Number(localStorage.getItem('replab.lastBackup') ?? 0);
  } catch {
    return 0;
  }
}

export async function downloadBackup() {
  const b = await repo.exportAll();
  downloadText(`replab-sicherung-${stamp()}.json`, JSON.stringify(b), 'application/json');
  try {
    localStorage.setItem('replab.lastBackup', String(Date.now()));
  } catch {
    /* egal */
  }
}

export function downloadPgn(rep: Repertoire, g: Graph, moves: Map<string, RepertoireMove>, marks: Map<string, PositionMark>) {
  const pgn = exportPgn(g, {
    name: rep.name,
    notes: new Map([...moves.values()].map((m) => [m.posKey, m.note])),
    labels: new Map([...marks.values()].map((m) => [m.posKey, m.label])),
    extraOpp: new Map([...marks.values()].map((m) => [m.posKey, m.extraOppMoves ?? []])),
  });
  const safe = rep.name.replace(/[^\p{L}\p{N}_-]+/gu, '_');
  downloadText(`${safe}-${stamp()}.pgn`, pgn, 'application/x-chess-pgn');
}
