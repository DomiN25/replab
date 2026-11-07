# RepLab

Schach-Eröffnungsrepertoire bauen (ein Zug pro eigener Stellung), Lücken finden und mit FSRS lernen. Statische PWA, Daten lokal im Browser (IndexedDB).

## Starten

```
npm install
npm run dev
```

PC: http://localhost:5173 · Handy (gleiches WLAN): die „Network“-Adresse aus der Konsole, z. B. `http://192.168.178.20:5173`.
Am Handy über WLAN läuft alles außer Installation/Offline (dafür braucht es https → später GitHub Pages). Daten am Handy und am PC sind getrennt, bis der Sync (M7) kommt.

## Lichess-Datenbank

Der Opening Explorer verlangt einen persönlichen Token (ohne Rechte): https://lichess.org/account/oauth/token/create
- Entwicklung: Datei `.env.local` mit `LICHESS_TOKEN=lip_…` (wird nie gebaut oder committet)
- App: Einstellungen → Lichess-Datenbank → Token

Ohne Token funktionieren Brett, Engine, Training und PGN-Import; Lücken basieren dann nur auf Markierungen aus der PGN.

## Tests

```
npm test        # Vitest: 88 Unit-/Integrationstests
npm run e2e     # Playwright (Edge): Bauen, Training (Handy-Profil), Seed/Galaxie
```

## Lizenz

GPL-3.0-or-later (wegen Stockfish, chessground, chessops). Eröffnungsnamen: lichess-org/chess-openings (CC0).
