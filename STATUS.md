# STATUS – RepLab

stand: 2026-11-07 · next: Lichess-Token in `.env.local` + Live-Test Explorer/Lücken; Handy-Test im WLAN; dann M6/M7 bewerten

## Ziel
PWA zum Bauen (ein Zug pro eigener Stellung), Lücken-Finden und FSRS-Lernen des Eröffnungsrepertoires. Anforderungen: `PFLICHTENHEFT.md`, Regeln: `CLAUDE.md`.

## Aktueller Stand
- M0 erledigt (`docs/spikes.md`): Explorer braucht Token (401), CORS offen → kein Proxy. Stockfish 19 Lite-Single im Worker: Tiefe 18 in 0,94 s (PC). chessground+chessops ok.
- M1–M5 umgesetzt: Dexie-DB, Bauen (Kandidaten Explorer+Engine, Festlegen/Ändern, Notizen/Links/Tags, Ende-Marker, ignorieren/+relevant, Zugumstellungs-Hinweis), Graph-Worker, Baustellen, Galaxie (Anteil-Breiten, Rest < 3 %, Zoom, Familie/Wissen), Liste, PGN-Import mit Konfliktdialog, PGN-/JSON-Export, Seed, Training (Fällig/Neu/Linie, Fokus), Dashboard mit Wissensleisten, PWA.
- Tests: 88 Unit/Integration (Vitest) grün, 3 E2E (Playwright, Edge; Training im Pixel-7-Profil) grün. Build ok, kein Token im `dist/`.

## Entscheidungen (mit Begründung)
- Graph wird bei jeder Änderung komplett im Worker neu berechnet (statt inkrementell): 4.320 Knoten in 110 ms gemessen – Inkrementalität wäre Komplexität ohne Nutzen.
- Worker liest selbst aus IndexedDB (Dexie im Worker): keine großen postMessage-Pakete.
- Trainings-Reihenfolge: Baumdistanz der Pfade + „größte Gruppe zuerst“ (optimal gegen Nachbarschaften). Priorität bestimmt, welche Karten in die Sitzung kommen; Reihenfolge darin = Abwechslung.
- Antwort wird erst beim Weitergehen an die Sitzung gemeldet; Relearning genau einmal, ≥ 4 Karten später, nicht neben derselben Linie.
- Import-Konflikt: Standard = vorhandener Eintrag (nichts ohne Rückfrage überschreiben), sonst PGN-Hauptvariante; Ast des verworfenen Zugs wird übersprungen.
- Beim Festlegen in einem nicht relevanten Gegner-Ast werden die Gegnerzüge des Wegs automatisch als relevant markiert (sonst wäre der Eintrag unerreichbar).
- Verwaiste Einträge (nach Ändern eines Zugs) werden erkannt und auf Rückfrage gelöscht.
- Engine-Regel/Fallen nutzen nur gespeicherte Analysen (keine automatische Engine-Analyse aller Gegnerstellungen); für tiefe Linien gibt es den Knopf „Engine-Prüfung“.
- ts-fsrs auf 5.4.2 gepinnt (6.0 markiert die alte API als deprecated). Lint = `tsc` (kein ESLint).
- Strukturen-Studie wird nicht ins Repertoire importiert (Kapitel 04 Sveshnikov widerspricht Kalaschnikow 4…e5).
- Token im Dev-Modus aus `.env.local` (`LICHESS_TOKEN`), im Build per `define` hart leer.
- Umwandlung am Brett automatisch zur Dame. Linien-Modus: nur Fehler fließen in FSRS ein.

## Offene Fragen / Funde
- Spanisch-Studie Kapitel 02 widerspricht sich selbst: dieselbe Stellung nach 8…O-O mit 9.Lxc6 (Hauptlinie 4…Ld7) und 9.Lf1 (Variante 4…exd4). Entscheidung beim Import nötig.
- 5.O-O (Repertoire-Karte) vs. 5.d3 (Studie Kap. 06): Entscheidung beim Import.
- Weiß-Seed hat keine LÜCKE-Marker → ohne Token 0 Lücken; echte Lücken erst mit Explorer-Daten.

## Ungetestet (ehrlich)
- Explorer live mit echtem Token (nur Mock + 401-Check). Echtes Handy (nur Emulation). Echter Offline-Betrieb (SW-Precache geprüft, Netz nicht abgeschaltet). Engine-Prüfung-Knopf, Linien-Modus, Fokus-Filter, PGN-/JSON-Download per UI (Logik per Unit-Test geprüft).

## Next Steps
1. `.env.local` mit `LICHESS_TOKEN=lip_…` anlegen, `npm run dev`, Spike-Seite + Lücken prüfen.
2. Am Handy im WLAN testen (`npm run dev` zeigt die Network-URL).
3. Eine Woche täglich trainieren (M5-Abnahme), danach M6 (Feinschliff Heatmap, Erreichbarkeit/Fallen) und M7 (GitHub Pages, Supabase-Sync) bewerten.

## Wichtige Pfade
- `src/core/` Logik + `tests/` · `src/data/` Dexie · `src/services/` Explorer/Engine/Graph-Client · `src/workers/graph.worker.ts`
- `src/ui/` (Builder, Candidates, Galaxy, TreeList, Gaps, Trainer, Home, SettingsView, ImportDialog)
- `e2e/` Playwright · `docs/spikes.md` · `public/seed/` · `scripts/` (copy-engine, build-openings, make-icons)
