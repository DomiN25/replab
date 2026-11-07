// M0-Spike-Seite: prüft Explorer (CORS/Token), Stockfish-WASM im Worker, chessground + chessops.
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { Chessground } from 'chessground';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';
import { parseUci } from 'chessops/util';
import { makeSan } from 'chessops/san';

const $ = (id: string) => document.getElementById(id)!;
const results: Record<string, unknown> = {};
(window as unknown as { spikeResults: typeof results }).spikeResults = results;

// ---------- (a) Explorer ----------
async function spikeExplorer() {
  const out = $('outA');
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const url = `https://explorer.lichess.org/lichess?variant=standard&speeds=rapid,classical&ratings=1800,2000&fen=${encodeURIComponent(fen)}&moves=5&topGames=0&recentGames=0`;
  const lines: string[] = [];
  try {
    const r = await fetch(url);
    lines.push(`Ohne Token: HTTP ${r.status}`);
    results.explorerNoToken = r.status;
  } catch (e) {
    lines.push(`Ohne Token: fetch-Fehler (CORS/Netz): ${String(e)}`);
    results.explorerNoToken = 'error:' + String(e);
  }
  const token = __DEV_LICHESS_TOKEN__;
  if (!token) {
    lines.push('Mit Token: übersprungen (kein LICHESS_TOKEN in .env.local)');
    results.explorerToken = 'no-token';
  } else {
    try {
      const t0 = performance.now();
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const ms = Math.round(performance.now() - t0);
      lines.push(`Mit Token: HTTP ${r.status} (${ms} ms)`);
      results.explorerToken = r.status;
      if (r.ok) {
        const j = await r.json();
        const total = j.white + j.draws + j.black;
        lines.push(`Partien gesamt: ${total}, Eröffnung: ${j.opening?.name ?? '–'}`);
        for (const m of j.moves) {
          const n = m.white + m.draws + m.black;
          lines.push(`  ${m.san.padEnd(6)} ${((100 * n) / total).toFixed(1)} %  (${n})`);
        }
        results.explorerMoves = j.moves.length;
      }
    } catch (e) {
      lines.push(`Mit Token: fetch-Fehler: ${String(e)}`);
      results.explorerToken = 'error:' + String(e);
    }
  }
  out.textContent = lines.join('\n');
  out.className = String(results.explorerToken) === '200' ? 'ok' : 'warn';
}

// ---------- (b) Stockfish ----------
function spikeStockfish() {
  const out = $('outB');
  const lines: string[] = [];
  const t0 = performance.now();
  let tGo = t0;
  let worker: Worker;
  try {
    worker = new Worker(new URL('engine/stockfish-19-lite-single.js', document.baseURI).href);
  } catch (e) {
    out.textContent = 'Worker-Start fehlgeschlagen: ' + String(e);
    out.className = 'bad';
    results.stockfish = 'error';
    return;
  }
  let lastInfo = '';
  worker.onerror = (e) => {
    lines.push('Worker-Fehler: ' + e.message);
    out.textContent = lines.join('\n');
    out.className = 'bad';
    results.stockfish = 'error';
  };
  worker.onmessage = (ev: MessageEvent<string>) => {
    const line = String(ev.data);
    if (line === 'uciok') {
      lines.push(`uciok nach ${Math.round(performance.now() - t0)} ms`);
      worker.postMessage('setoption name MultiPV value 3');
      worker.postMessage('isready');
    } else if (line === 'readyok') {
      results.sfReadyMs = Math.round(performance.now() - t0);
      lines.push(`readyok nach ${results.sfReadyMs} ms → go depth 18`);
      tGo = performance.now();
      worker.postMessage('position startpos');
      worker.postMessage('go depth 18');
    } else if (line.startsWith('info depth') && line.includes(' pv ')) {
      lastInfo = line;
    } else if (line.startsWith('bestmove')) {
      const ms = Math.round(performance.now() - tGo);
      lines.push(`Letzte Info: ${lastInfo.slice(0, 160)}…`);
      lines.push(`${line}  (Tiefe 18 in ${ms} ms)`);
      results.stockfish = 'ok';
      results.sfDepth18Ms = ms;
      out.className = 'ok';
      worker.terminate();
    }
    out.textContent = lines.join('\n');
  };
  worker.postMessage('uci');
}

// ---------- (c) Brett ----------
function spikeBoard() {
  const out = $('outC');
  const pos = Chess.fromSetup(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').unwrap()).unwrap();
  const sans: string[] = [];
  const cg = Chessground($('board'), {
    fen: makeFen(pos.toSetup()),
    movable: { free: false, color: 'white', dests: chessgroundDests(pos), showDests: true },
    drawable: { enabled: true },
    events: {
      move: (orig, dest) => {
        const move = parseUci(orig + dest)!;
        sans.push(makeSan(pos, move));
        pos.play(move);
        const turn = pos.turn;
        cg.set({ fen: makeFen(pos.toSetup()), turnColor: turn, movable: { color: turn, dests: chessgroundDests(pos) } });
        out.textContent = `Züge: ${sans.join(' ')}\nFEN: ${makeFen(pos.toSetup())}`;
        results.boardMoves = sans.length;
      },
    },
  });
  cg.setAutoShapes([
    { orig: 'e2', dest: 'e4', brush: 'green' },
    { orig: 'd2', dest: 'd4', brush: 'yellow' },
  ]);
  out.textContent = 'Brett bereit. Ziehen oder tippen.';
  results.board = 'ok';
}

$('runA').addEventListener('click', spikeExplorer);
$('runB').addEventListener('click', spikeStockfish);
spikeBoard();
spikeExplorer();
spikeStockfish();
