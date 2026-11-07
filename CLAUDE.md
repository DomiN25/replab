# CLAUDE.md – RepLab (Schach-Repertoire bauen & lernen)

## Projekt in einem Satz
Web-App (PWA), mit der Dominik sein Schach-Eröffnungsrepertoire baut (pro eigener Stellung genau ein Zug), Lücken findet und es per FSRS-Wiederholung lernt. Vollständige Anforderungen: **`PFLICHTENHEFT.md`** (immer zuerst lesen, bei Widersprüchen gilt das Pflichtenheft).

## Arbeitsweise
- Meilenstein für Meilenstein (M0 → M8, siehe Pflichtenheft Kap. 7). Vor jedem Meilenstein kurz den Plan nennen, danach Status-Update: was fertig ist, was getestet wurde, was offen ist.
- **M0-Spikes zuerst** (Explorer CORS/Token, Stockfish-WASM, Brett). Ergebnis in `docs/spikes.md` festhalten.
- Kleine, nachvollziehbare Commits. Keine großen Umbauten ohne Rückfrage.
- Bei echten Unklarheiten fragen; bei Kleinigkeiten sinnvoll entscheiden und im Status-Update erwähnen.
- Ehrlich berichten: Wenn etwas nicht funktioniert oder ungetestet ist, klar sagen.

## Stack
TypeScript (strict) · Vite · React 18 · Zustand · Dexie (IndexedDB) · chessground + chessops · Stockfish WASM (Lite, Single-Thread, Web Worker) · ts-fsrs · D3 · Vitest · Playwright · vite-plugin-pwa. Lizenz der App: GPL-3 (wegen Stockfish/chessground/chessops).

## Befehle (nach Setup anpassen)
- `npm run dev` – Entwicklungsserver
- `npm run build` – Produktions-Build
- `npm test` – Vitest
- `npm run e2e` – Playwright
- `npm run lint` / `npm run typecheck`

## Architektur-Regeln
- `src/core/` enthält reine, UI-freie Logik (posKey, Graph, Lücken, Erreichwahrscheinlichkeit, Strukturen, SRS-Mapping, PGN). Alles dort hat Unit-Tests.
- **Stellungen werden über `posKey` identifiziert** (FEN ohne Zugzähler, en passant nur wenn legal). Nie über Zugfolgen – Zugumstellungen müssen zusammenfallen.
- Pro Repertoire und Stellung **höchstens ein** eigener Zug.
- Schwere Arbeit (Stockfish, Lückenberechnung) läuft in Web Workern; die UI bleibt flüssig.
- Daten local-first in IndexedDB; jeder Datensatz hat `updatedAt` (für späteren Sync).

## Lichess-Explorer-Regeln (wichtig)
- Endpunkte: `https://explorer.lichess.org/lichess` und `/masters`. Standard: `speeds=rapid,classical`, `ratings=1800,2000`.
- **Immer nur eine Anfrage gleichzeitig** (Warteschlange). Bei HTTP 429 mindestens 60 s warten. Antworten 30 Tage cachen.
- Optionaler persönlicher Token aus den Einstellungen als `Authorization: Bearer <token>`. Token nie loggen, nie in Sync/Export aufnehmen.

## UI-Regeln
- Alle Texte Deutsch, Figuren in deutscher Notation (S, L, T, D, K). Intern UCI/SAN englisch.
- Look: dunkle „Sternwarte“ (Nachtblau, Mint = eigener Zug, Bernstein = Gegnerzug, Rot = Lücke). Chakra Petch + IBM Plex Sans.
- Mobile first beim Training (große Touch-Ziele, Bottom-Sheet), Desktop-Layout mit drei Spalten beim Bauen.
- `prefers-reduced-motion` beachten, sichtbarer Fokus.

## Nicht tun
- Kein Fehlerradar-Modell einbinden (bewusst ausgeschlossen).
- Keine automatische „Linie fertig“-Logik – Linien enden nur per Ende-Marker.
- Erreichwahrscheinlichkeit und Fallen nur dezent anzeigen, nicht in den Mittelpunkt stellen.
- Keine Daten ohne Rückfrage löschen oder überschreiben (z. B. beim Ändern eines Repertoirezugs Lernhistorie nur nach Bestätigung verwerfen).
