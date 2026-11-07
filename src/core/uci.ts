// Parser für UCI-Ausgaben von Stockfish.

export interface UciInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  cp?: number;
  mate?: number;
  bound?: 'lower' | 'upper';
  nodes?: number;
  nps?: number;
  time?: number;
  pv: string[];
}

/** "info depth 18 ... multipv 2 score cp 26 ... pv e2e4 e7e5" → UciInfo (nur Zeilen mit pv). */
export function parseInfo(line: string): UciInfo | undefined {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return undefined;
  const t = line.split(/\s+/);
  const info: UciInfo = { depth: 0, multipv: 1, pv: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        info.depth = Number(t[++i]);
        break;
      case 'seldepth':
        info.seldepth = Number(t[++i]);
        break;
      case 'multipv':
        info.multipv = Number(t[++i]);
        break;
      case 'nodes':
        info.nodes = Number(t[++i]);
        break;
      case 'nps':
        info.nps = Number(t[++i]);
        break;
      case 'time':
        info.time = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        if (kind === 'cp') info.cp = v;
        else if (kind === 'mate') info.mate = v;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') {
          info.bound = t[++i] === 'lowerbound' ? 'lower' : 'upper';
        }
        break;
      }
      case 'pv':
        info.pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
      default:
        break;
    }
  }
  return info.depth > 0 ? info : undefined;
}

export function parseBestMove(line: string): string | undefined {
  const m = /^bestmove\s+(\S+)/.exec(line);
  return m && m[1] !== '(none)' ? m[1] : undefined;
}
