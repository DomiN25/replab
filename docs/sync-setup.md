# Google-Drive-Sync einrichten (einmalig, ca. 5 Minuten)

RepLab speichert den Sync-Stand in einer Datei im **versteckten App-Ordner** deines Google Drives (Berechtigung `drive.appdata`). Die App sieht dort nur ihre eigene Datei, keine anderen Drive-Inhalte. Dafür braucht es eine eigene OAuth-Client-ID. Sie ist **kein Geheimnis** (sie steht ohnehin im ausgelieferten JavaScript), ein Client-Secret wird nicht benötigt.

## 1. Projekt und Drive-API
1. https://console.cloud.google.com öffnen (mit deinem Google-Konto).
2. Oben „Projekt auswählen“ → **Neues Projekt** → Name `RepLab` → Erstellen.
3. Menü → **APIs & Dienste → Bibliothek** → „Google Drive API“ → **Aktivieren**.

## 2. OAuth-Zustimmungsbildschirm („Google Auth Platform“)
1. Menü → **APIs & Dienste → OAuth-Zustimmungsbildschirm** → „Jetzt starten“.
2. App-Name `RepLab`, Support-E-Mail: deine Adresse → Zielgruppe **Extern** → Kontaktdaten → Erstellen.
3. **Zielgruppe** → Testnutzer → **deine Gmail-Adresse hinzufügen** (im Testmodus dürfen sich nur Testnutzer anmelden).
4. **Datenzugriff** → Bereiche hinzufügen → `.../auth/drive.appdata` auswählen → Speichern.

## 3. Client-ID anlegen
1. **Clients** (bzw. „Anmeldedaten“) → **Client erstellen** → Typ **Webanwendung**, Name `RepLab Web`.
2. **Autorisierte JavaScript-Quellen**:
   - `https://domin25.github.io`
   - `http://localhost:5173`
3. Weiterleitungs-URIs: leer lassen → Erstellen.
4. Die **Client-ID** (`…apps.googleusercontent.com`) kopieren.

## 4. In RepLab eintragen
- **Einfach:** in der App → Einstellungen → „Sync über Google Drive“ → Client-ID einfügen → „Mit Google verbinden“. (Gilt pro Gerät.)
- **Fest eingebaut (empfohlen):** als GitHub-Variable `GOOGLE_CLIENT_ID` im Repo hinterlegen; der Build baut sie dann für alle Geräte ein:
  ```
  gh variable set GOOGLE_CLIENT_ID --repo DomiN25/replab --body "DEINE-ID.apps.googleusercontent.com"
  ```
  Danach den Workflow neu laufen lassen (Push oder „Run workflow“). Für die lokale Entwicklung: `VITE_GOOGLE_CLIENT_ID=…` in `.env.local`.

Beim ersten Verbinden zeigt Google „Diese App wurde nicht überprüft“ – das ist im Testmodus normal: **Erweitert → Weiter zu RepLab**.

## Grenzen
- Ohne eigenen Server gibt Google im Browser nur Zugangstokens für ca. 1 Stunde aus. Danach zeigt das Wolken-Symbol „!“; ein Tipp verbindet neu. Änderungen gehen dazwischen nicht verloren.
- Popups müssen für die Seite erlaubt sein.
- Konflikte: pro Zug/Karte/Markierung gewinnt der neuere Stand (Zeitstempel). Löschungen werden mitgeführt. Wiederholungen beider Geräte werden zusammengeführt.
