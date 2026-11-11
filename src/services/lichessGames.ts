// Eigene Lichess-Partien laden (öffentliche API, NDJSON-Stream). Ein Token ist optional (höheres Limit).
// Der Token wird nur als Header gesendet, nie protokolliert.
import { MAX_PLIES, type GameRec } from '../core/opponentStats';

interface ApiGame {
  id?: string;
  moves?: string;
  analysis?: { eval?: number; mate?: number }[];
  winner?: string;
  variant?: string;
  initialFen?: string;
  createdAt?: number;
  players?: { white?: { user?: { id?: string; name?: string } }; black?: { user?: { id?: string; name?: string } } };
}

/** Matt zählt als sehr große Bewertung (±2000 cp), damit Verläufe vergleichbar bleiben. */
const evalCp = (a: { eval?: number; mate?: number }) => (a.mate !== undefined ? (a.mate > 0 ? 2000 : -2000) : a.eval ?? 0);

/** API-Partie → kompakter Datensatz aus meiner Sicht; undefined bei fremder Variante, Fremdstellung oder fehlendem Namen. */
export function toGameRec(g: ApiGame, userId: string): GameRec | undefined {
  if (!g.moves || (g.variant && g.variant !== 'standard') || g.initialFen) return undefined;
  const w = g.players?.white?.user?.id;
  const b = g.players?.black?.user?.id;
  const c = w === userId ? 'w' : b === userId ? 'b' : undefined;
  if (!c) return undefined;
  const mine = c === 'w' ? 'white' : 'black';
  const r = g.winner === undefined ? 0 : g.winner === mine ? 1 : -1;
  const opp = c === 'w' ? g.players?.black?.user?.name : g.players?.white?.user?.name;
  const rec: GameRec = { c, r, m: g.moves.split(' ').slice(0, MAX_PLIES).join(' '), t: g.createdAt, src: 'lichess' };
  if (g.id) {
    rec.id = g.id;
    rec.url = `https://lichess.org/${g.id}`;
  }
  if (opp) rec.opp = opp;
  if (g.analysis?.length) rec.ev = g.analysis.slice(0, MAX_PLIES).map(evalCp);
  return rec;
}

export interface FetchOptions {
  max: number;
  token?: string;
  signal?: AbortSignal;
  onProgress?: (n: number) => void;
  fetchImpl?: typeof fetch;
}

export async function fetchLichessGames(user: string, o: FetchOptions): Promise<GameRec[]> {
  const name = user.trim();
  if (!name) throw new Error('Bitte zuerst deinen Lichess-Namen eintragen.');
  const id = name.toLowerCase();
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(name)}` +
    `?max=${o.max}&rated=true&moves=true&tags=false&clocks=false&evals=true&opening=false&perfType=blitz,rapid,classical,correspondence`;
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const res = await (o.fetchImpl ?? fetch)(url, { headers, signal: o.signal });
  if (res.status === 404) throw new Error(`Lichess kennt den Namen „${name}“ nicht.`);
  if (res.status === 429) throw new Error('Lichess-Limit erreicht – bitte etwa eine Minute warten.');
  if (!res.ok) throw new Error(`Lichess antwortet mit Fehler ${res.status}.`);
  const out: GameRec[] = [];
  const take = (line: string) => {
    if (!line.trim()) return;
    try {
      const rec = toGameRec(JSON.parse(line) as ApiGame, id);
      if (rec) out.push(rec);
    } catch {
      /* kaputte Zeile überspringen */
    }
  };
  if (!res.body) {
    (await res.text()).split('\n').forEach(take);
    return out;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    lines.forEach(take);
    o.onProgress?.(out.length);
  }
  take(buf + dec.decode());
  o.onProgress?.(out.length);
  return out;
}
