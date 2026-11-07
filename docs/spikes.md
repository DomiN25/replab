# M0 – Spikes (07.11.2026)

Testseite: `spike.html` (`npm run dev` → http://localhost:5173/spike.html). Ergebnisse stehen zusätzlich in `window.spikeResults`.

## (a) Lichess Opening Explorer

| Prüfung | Ergebnis | Beleg |
|---|---|---|
| Erreichbar ohne Token? | **Nein.** HTTP 401 „Authorization Required“ | `curl` und `fetch` aus dem Browser (localhost:5173) |
| CORS | **Offen.** `Access-Control-Allow-Origin: *`, erlaubte Header inkl. `Authorization`, Preflight 204 | `curl -X OPTIONS …` sowie: `fetch` wirft keinen CORS-Fehler, sondern liefert den 401-Status lesbar zurück |
| Mit Token (08.11.) | **Funktioniert.** HTTP 200 in 73 ms, z. B. nach 1.e4: e5 38 %, c5 25 %, e6 11 % | Spike-Seite mit Token aus `.env.local` |
| Abfragelimit (08.11.) | Ca. 25–30 Anfragen am Stück, dann **429**. Mit 60 s Pause effektiv nur ~0,4 Anfragen/s | Messung beim Lückenscan (3× 429 im Abstand von ~75 s) |

**Folgerung:** Kein Proxy nötig. Ein persönlicher Lichess-Token (ohne Scopes) ist Pflicht. Die App fragt ihn in den Einstellungen ab (nur lokal gespeichert, nie exportiert) und zeigt bei 401 einen klaren Hinweis. Im Dev-Modus kommt er alternativ aus `.env.local`; im Produktions-Build wird der Wert per `define` hart auf `''` gesetzt.

**Gegenmaßnahme Limit:** Hintergrund-Anfragen (Lückenscan) mit 2 s Abstand, die aktuelle Stellung beim Klicken drängelt vor. Ergebnis: 41 Anfragen in knapp 2 min ohne ein einziges 429. Der erste Vollscan des Weiß-Repertoires (~200 Gegnerstellungen) dauert damit einige Minuten, danach greift der 30-Tage-Cache.

**Plan B** (nur falls Lichess später CORS sperrt): Cloudflare-Worker als Proxy, der `Authorization` durchreicht. Aktuell nicht nötig.

## (b) Stockfish WASM im Web Worker

| Prüfung | Ergebnis |
|---|---|
| Paket | npm `stockfish@19.0.1`, Datei `stockfish-19-lite-single.js` (28 KB) + `.wasm` (1,8 MB) |
| Start im Worker | `uciok`/`readyok` nach **146 ms** |
| Tiefe 18, MultiPV 3, Startstellung | **939 ms** (PC, ~700 knps), `bestmove e2e4` |
| Header | Keine COOP/COEP nötig (Single-Thread) → GitHub Pages geeignet |

Die Dateien werden per `scripts/copy-engine.mjs` (läuft vor `dev`/`build`) nach `public/engine/` kopiert, weil ein Worker eine echte URL braucht. Ein eigener Wrapper-Worker (`stockfish.worker.ts` aus dem Pflichtenheft) ist überflüssig: Die Stockfish-Datei *ist* bereits ein Worker; der Wrapper sitzt im Hauptthread (`src/services/engine.ts`).

**Live auf GitHub Pages (08.11.):** Tiefe 18 in 0,79 s (PC-Browser), ohne COOP/COEP-Header.

**Ungetestet:** echtes Handy – dafür am Handy https://domin25.github.io/replab/spike.html öffnen. Erwartung nach Leistungsverhältnis: Faktor 3–6 langsamer, also Tiefe 18 in 3–6 s. Deshalb Standard-Tiefe am Handy 14 (Pflichtenheft 8) und Abbruch beim Weiterklicken.

## (c) chessground + chessops

| Prüfung | Ergebnis |
|---|---|
| Brett rendern (chessground 9.2.1, cburnett-Figuren) | ok |
| Legale Ziele aus chessops (`chessgroundDests`) | ok |
| Zug per Tippen (Feld → Feld) | ok: `e4`, FEN korrekt aktualisiert |
| SAN aus chessops (`makeSan`) | ok |
| Pfeile (`setAutoShapes`, grün/gelb) | ok |
| En-passant-Normalisierung | `makeFen` von chessops setzt das ep-Feld nur, wenn ein ep-Schlag legal ist (nach 1.e4: `-`) → passt direkt zu `posKey` (Pflichtenheft 4.1); per Unit-Test abgesichert |

**Ungetestet:** Ziehen per Drag am Touchscreen (chessground unterstützt es, Lichess-Mobile nutzt dasselbe).

## Versionen (gepinnt)

React 18, Vite 6, Vitest 3, ts-fsrs **5.4.2** (6.0 baut seine API gerade um, alte Funktionen sind dort `deprecated`), Dexie 4, chessops 0.15, chessground 9, D3 7, Zustand 5.
