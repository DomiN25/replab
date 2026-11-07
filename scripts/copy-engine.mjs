// Kopiert den Stockfish-Lite-Single-Build (js + wasm) nach public/engine/,
// damit Vite ihn als statische Datei ausliefert (Worker braucht eine echte URL).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dst = join(root, 'public', 'engine');
mkdirSync(dst, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  const from = join(src, f);
  if (!existsSync(from)) throw new Error(`Stockfish-Datei fehlt: ${from}`);
  copyFileSync(from, join(dst, f));
}
console.log('[copy-engine] Stockfish lite-single -> public/engine/');
