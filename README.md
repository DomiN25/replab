# RepLab

Schach-Eröffnungsrepertoire bauen (ein Zug pro eigener Stellung), Lücken finden und mit FSRS lernen. Statische PWA, Daten lokal im Browser (IndexedDB).

**App:** https://domin25.github.io/replab/ (wird bei jedem Push auf `main` per GitHub Actions neu gebaut)

## Am Handy

1. https://domin25.github.io/replab/ öffnen → Browser-Menü → „Zum Startbildschirm hinzufügen“ (Android/Chrome: „App installieren“).
2. Nach dem ersten Laden funktioniert das Training offline.
3. Daten vom PC übernehmen: am PC Einstellungen → „JSON-Sicherung exportieren“, Datei z. B. in Google Drive legen, am Handy auf dem Startbildschirm „Sicherung einspielen“.
   Bis zum Sync (M7) sind die Daten je Gerät getrennt; auch `localhost` und die GitHub-Seite sind getrennte Speicher.
4. Für Datenbank-Daten am Handy den Lichess-Token unter Einstellungen eintragen (bleibt nur auf dem Gerät). Training braucht keinen Token.

## Entwicklung

```
npm install
npm run dev
```

Lichess-Token für die Entwicklung: `.env.local` mit `LICHESS_TOKEN=lip_…` (nie committen; im Build immer leer).
Token anlegen: https://lichess.org/account/oauth/token/create (keine Rechte nötig).

Private Dateien (nicht im Repo): `public/seed/*.pgn` (Startrepertoire), `PFLICHTENHEFT.md`, `STATUS.md`.

## Tests

```
npm test        # Vitest (Seed-Tests laufen nur lokal mit den privaten PGNs)
npm run e2e     # Playwright (Edge): Bauen, Training (Handy-Profil), Seed/Galaxie (lokal)
```

## Lizenz

GPL-3.0-or-later (wegen Stockfish, chessground, chessops), siehe `LICENSE`. Eröffnungsnamen: lichess-org/chess-openings (CC0).
