# UX-Review RepLab – 09.11.2026

Prüfung als kritischer Tester: alle Ansichten am Desktop (1440 px, echte Daten: Hauptrepertoire Weiß, 196 Einträge, 381 Lücken, Studie „tbg“ mit 26 Kapiteln) und am Handy (Pixel-7-Simulation, hell + dunkel), dazu Abläufe im Code nachvollzogen.
Nicht geprüft: echtes Gerät, echter Google-Login, echter Offline-Betrieb, Screenreader.

Priorität: **P1** = stört die Kernnutzung oder kann Daten/Arbeit kosten · **P2** = deutlich spürbar · **P3** = Feinschliff.

---

## P1 – zuerst angehen (umgesetzt am 09.11.2026)

1. **Studien sind nirgends gesichert.** Studien und ihre Bearbeitungen (Schnitte, Wahl, Fortschritt) liegen nur in IndexedDB dieses Browsers – weder im Google-Drive-Sync noch in der JSON-Sicherung (`exportAll` lässt `studies` aus). Browserdaten weg = Studienarbeit weg. Außerdem sieht das Handy die am PC zugeschnittene Studie nicht.
2. **Trainingssitzung geht verloren.** Die Sitzung lebt nur im Zustand der Trainer-Ansicht. Wechsel des Reiters (Desktop: Navigation bleibt sichtbar), der Link „Stellung im Repertoire öffnen“ mitten in der Sitzung oder „Beenden“ (ohne Rückfrage) werfen sie weg. Antworten sind gespeichert, aber Reihenfolge, Relearning-Karten und Fortschritt sind weg; kein „Fortsetzen“.
3. **Kandidatentabelle passt am Desktop nicht.** Bei 1440 px ist die mittlere Spalte 326 px breit, die Tabelle 438 px → horizontales Scrollen; die Aktionsspalte (Festlegen/Ändern, ⋯) liegt außerhalb. Genau die wichtigste Bedienung ist versteckt. (3-Spalten-Layout gibt Brett und Galaxie je ~495 px, der Tabelle nur 358 px.)
4. **Jeder eigene Zug kostet einen Bestätigungsdialog.** Zug am Brett in einer eigenen Stellung ohne Eintrag → Dialog „Festlegen / Nur ansehen“; „Festlegen“ in der Tabelle → Dialog. Beim Erkunden (nur ansehen) und beim schnellen Aufbauen (Lückentour!) nervt das bei jedem Zug. Besser: direkt festlegen + Kurzmeldung mit „Rückgängig“; Erkunden ohne Dialog (z. B. Festlegen nur über Tabelle/Knopf).
5. **381 Lücken als Hauptzahl.** Start, Kopfleiste und Lücken-Seite zeigen ungefiltert 381 (davon ~340 unter 0,5 % Erreichbarkeit). Das demotiviert und versteckt die wichtigen ~41. Standard sollte ein sinnvoller Filter sein (z. B. ≥ 0,5 %), Rest als „selten“.

## P2 – deutlich spürbar (umgesetzt am 09.11.2026, Pakete A–F)

### Navigation & Struktur
6. **Uneinheitliche Begriffe:** Reiter „Lücken“ ↔ Seite „Baustellen“ ↔ Knopf „Baustellen ansehen“; „Einstellungen“ (Desktop) ↔ „Mehr“ (Handy); „Einträge“ ↔ „Karten“ ↔ „Stellungen“ werden gemischt (Start: „Einträge 196“, „Wissen pro Familie: Offene Spiele 404“ – 404 was?).
7. **Wichtige Abläufe stecken in „Einstellungen“:** PGN-Import, Export, Repertoires anlegen/leeren/löschen, Sync. Der Import existiert zweimal (Einstellungen-Dialog und Studien „hinzufügen“) mit unterschiedlicher Logik. Vorschlag: Import nur noch über Studien (oder ein zentraler „+ Hinzufügen“), Repertoire-Verwaltung als eigene kleine Seite.
8. **Android-Zurück-Taste** schließt weder Dialoge noch das aufgezogene Sheet, sondern springt eine Ansicht zurück (Hash-Routing ohne Verlaufseinträge für Overlays). Auf Android erwartet man das Gegenteil.
9. **„Training starten“ auf Start startet nichts**, sondern öffnet die Trainingsseite → zweiter Tipp nötig.
10. **Einstellungen am Handy sind ~9.700 px lang** (eine Seite, 8 Karten, keine Gliederung/Sprungmarken). Experten-Optionen (cp-Schwellen, MultiPV, Ratingbänder, Mindestanteile) stehen gleichrangig neben Alltagsoptionen.
11. **Entwickler-Knöpfe im Live-Build:** „Startrepertoire laden“ und „Studie ‚Spanisch‘ importieren“ stehen in den Einstellungen auch dort, wo es die Seed-Dateien nicht gibt (live) → Fehlermeldung. Auf der Startseite wird das geprüft, in den Einstellungen nicht.

### Bauen
12. **Keine Suche** nach Eröffnung/Name/Zugfolge/Notiz – um eine Linie zu finden, muss man nachspielen oder in Galaxie/Liste suchen.
13. **Abweichungs-Hinweis sprachlich holprig:** „Bei 1. spielst du laut Repertoire e4, hier wurde d4 gespielt.“ → besser „Abweichung bei 1.: Repertoire 1.e4, hier 1.d4.“ Zugnummer fehlt beim gespielten Zug.
14. **Engine-Zeilen ohne Zugnummer des ersten Zugs** („e5 2.Sf3 …“ statt „1…e5 2.Sf3“), bei Schwarz-Stellungen verwirrend.
15. **Tastaturkürzel unsichtbar** (←/→, f, Leertaste existieren, werden nirgends erklärt); keine Zugeingabe per Tastatur (SAN tippen) am Desktop.
16. **„Name: 1.e4 – dein Weiß-Repertoire ✎“** wirkt wie ein Fehler (Label der Wurzel als Stellungsname).

### Lücken / Lückentour
17. **Familienkarten mit 251 Einträgen** ohne Einklappen/„mehr anzeigen“ → endlose Seite; Karten ungleich hoch nebeneinander.
18. **Keine Aktionen direkt in der Lückenliste** (ignorieren, Ende-Marker, „später“) – immer erst ins Bauen springen.
19. **Standard-Sortierung „nach Tiefe“** stellt 0,1 %-Lücken gleichrangig neben 1 %-Lücken; „nach Erreichwahrscheinlichkeit“ wäre der nützlichere Standard.

### Training
20. **Nach „Sitzung beendet“ kein „Weiter lernen“** (nächste 10 neuen / restliche fällige) – nur „Fertig“.
21. **Kein manueller Einfluss auf die Bewertung:** Zeitgrenzen (4 s/15 s) entscheiden allein über leicht/schwer; ein Fehlgriff (Maus abgerutscht) zählt voll als „vergessen“, kein „war ein Verklicker“.
22. **Kein Überblick, was gelernt wird:** Welche Linie/Familie kommt dran, wie viele Karten in welchem Ast fällig sind, Prognose „morgen fällig: X“ fehlt (nur Zahl auf Start).

### Studien
23. **Pfeil-Flut auf dem Brett:** Bei vielen Fortsetzungen (tbg nach 1…c5: 12 Gegnerzüge) zeichnet das Brett alle Pfeile → unlesbar. Besser: Hauptzug + max. 3 häufigste, Rest nur in der Leiste.
24. **Kapitel lassen sich nicht anspringen**, nur an-/abwählen. Bei 26 Kapiteln fehlt „zu Kapitel 7 (Rossolimo 7.Lc2)“.
25. **Fortschritt „3/8710“ ist abschreckend** und zählt auch nicht gewählte eigene Nebenäste mit. Sinnvoller: Fortschritt pro Kapitel und nur über das, was übernommen würde.
26. **Übernahme nur als Ganzes:** +3.659 Einträge auf einmal. Es fehlt „nur dieses Kapitel/diesen Ast übernehmen“ oder „bis Tiefe/Erreichbarkeit X“.
27. **Farberkennung bei kleinen Studien** fällt still auf Weiß zurück; der Dialog zeigt dann „Weiß“ ohne Hinweis, dass nur geraten wurde.

### Darstellung & Text
28. **Dezimaltrennzeichen englisch:** „8.6 %“, „≈ 38.2 %“, „≈ 0.7 %“ (Kandidaten, Lücken, Lückentour) – deutsch wäre „8,6 %“.
29. **Eröffnungsnamen halb übersetzt:** „Sizilianisch: O’Kelly Variation, Venice System, Steiner Line“, „Spanisch: Morphy Defense, Modern Steinitz Defense, Fianchetto Variation“ – nur die Familie ist deutsch; lange Namen laufen in Listen über.
30. **„Wissen pro Familie“ ohne Legende:** graue/rot gestreifte Balken, Zahl rechts unklar; Rot dominiert optisch (Lücken), obwohl es um Wissen geht.
31. **„Zuletzt bearbeitet“** zeigt nur „Le3“ ohne Zugnummer/Linie, Datum bei allen gleich.
32. **Kurzmeldungen verdecken Inhalt** am Handy (liegen über Sheet/Liste, z. B. über „wird übernommen“-Markierung); bei langen Texten zweizeilig.
33. **Topbar am Handy:** Repertoire-Name wird abgeschnitten („Hauptreper…“); Status-Punkt (Lichess-Datenbank) ohne Erklärung, Tooltip am Handy nicht erreichbar; Farbsymbole ○/● als Textzeichen im Auswahlfeld.

## P3 – Feinschliff

34. Zugleiste (Crumbs) am Handy nur 30 px hoch – unter der 44-px-Empfehlung für Touch.
35. Galaxie am Handy: Beschriftungen sehr klein, schmale Segmente kaum treffbar; Legende in 12 px.
36. Import-Dialog und „Studie hinzufügen“ schließen nicht mit Esc und haben keinen Fokus-Fang; das allgemeine Modal fängt Tab ebenfalls nicht ein.
37. Status nur über Farbe (rote Punkte für Lücke in Tabellen; Grün/Bernstein für eigene/Gegnerzüge) – für Farbschwäche zusätzlich Form/Text.
38. Einstellungen speichern beim Verlassen des Feldes ohne Rückmeldung; ungültige Werte werden still begrenzt.
39. Lade-Indikator „◌“ in der Lücken-Pille ist ein Textzeichen (Icon-Regel).
40. Schwarz-Repertoire-Studie: Kommentare eigener Züge erscheinen nur als 2-Zeilen-Vorschau in der Liste; voller Text erst nach dem Zug.
41. Leerer Zustand „Studien“ und „Training ohne Karten“ ohne direkte Aktion zum nächsten sinnvollen Schritt (z. B. „Studie per Link hinzufügen“ als großer Knopf, „Zum Bauen“).
42. „Linie durchspielen“ (Training) und „Lückentour“ (Bauen) – zwei geführte Modi mit ähnlichem Namen, Unterschied nirgends erklärt.

---

## Was gut funktioniert (nicht anfassen)
- Optik „Ozean“ hell/dunkel, Brett-Themes, Druck-Feedback, Bottom-Sheet am Handy.
- Fokus-Modus im Training, Vibration, Abschluss mit Häkchen.
- Studien-Variantenleiste + „Offen“ + gespeicherte Position.
- Abweichungs-Hinweis an sich (nur Wortlaut verbessern), Kapitel-Farbfilter beim Import.

## Vorschlag zur Reihenfolge
1. P1-1 (Studien in Sync + Sicherung) und P1-2 (Sitzung fortsetzen) – Arbeit darf nicht verloren gehen.
2. P1-3/P1-4 (Tabelle, Festlegen ohne Dialog + Rückgängig) – Kernbedienung beim Bauen.
3. P1-5 + P2-6/28/29 (Zahlen, Begriffe, Formatierung) – schnell, großer Eindruck.
4. Danach Studien-Feinheiten (23–26), Suche (12), Navigation/Einstellungen (7–11).

## Nachtrag 09.11.2026 – Stand nach P1/P2
- P1 und P2 umgesetzt (Commits 1d33c1d, a5f4639, 72754a9, 531e4ca, c3f7283, e769e30 und Paket F).
- Bewusst nicht/teilweise: Topbar-Repertoirename bleibt abgeschnitten (Auswahlfeld), Farbsymbole ○/● im Auswahlfeld bleiben (Optionen können keine SVG). Eröffnungsnamen: nur häufige Begriffe übersetzt, Eigennamen bleiben.
- Neu beobachtet: Kapitel-Reiter einer großen Studie (26 Kapitel) braucht beim Öffnen ~0,26 s (PC, Entwicklungsmodus) – am Handy ggf. spürbar; ggf. in einen Worker verlagern.
- Offen: P3 (Touch-Ziele Zugleiste, Galaxie am Handy, Farbschwäche, Einstellungs-Rückmeldung, leere Zustände, Begriffe „Linie durchspielen“/„Lückentour“).

