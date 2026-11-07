// Baut src/data/openings.json (posKey → englischer Eröffnungsname) aus lichess-org/chess-openings (CC0).
// Aufruf: node scripts/build-openings.mjs [ordner-mit-a..e.tsv]   (ohne Ordner: Download von GitHub)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePgn } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];

async function load(name) {
  if (dir) return readFileSync(join(dir, name), 'utf8');
  const r = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.text();
}

const out = {};
let rows = 0;
for (const f of ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv']) {
  const lines = (await load(f)).split(/\r?\n/).slice(1).filter(Boolean);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const game = parsePgn(pgn)[0];
    const pos = Chess.default();
    let ok = true;
    for (const node of game.moves.mainline()) {
      const m = parseSan(pos, node.san);
      if (!m) {
        ok = false;
        break;
      }
      pos.play(m);
    }
    if (!ok) continue;
    const key = makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ');
    // Bei Mehrfachtreffern den kürzeren (allgemeineren) Namen behalten
    if (!out[key] || name.length < out[key].length) out[key] = name;
    rows++;
    void eco;
  }
}
mkdirSync(join(root, 'src', 'data'), { recursive: true });
writeFileSync(join(root, 'src', 'data', 'openings.json'), JSON.stringify(out));
console.log(`[openings] ${rows} Zeilen → ${Object.keys(out).length} Stellungen`);
