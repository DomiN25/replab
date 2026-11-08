// Einstellungen → Sync über Google Drive.
import { useState } from 'react';
import { useApp } from './store';
import { connectSync, disconnectSync, refreshSyncConfig, syncNow, syncTitle } from './sync';
import { builtInClientId, googleClientId, setGoogleClientId } from '../services/googleAuth';

const SETUP_URL = 'https://github.com/DomiN25/replab/blob/main/docs/sync-setup.md';

export function SyncSettings() {
  const sync = useApp((s) => s.sync);
  const [cid, setCid] = useState(() => (builtInClientId() ? '' : googleClientId() ?? ''));
  const builtIn = builtInClientId();

  return (
    <section className="card" id="sync">
      <h2>Sync über Google Drive</h2>
      <p className="hint">
        Repertoire, Lernstand und Einstellungen werden in einer Datei im <b>versteckten App-Ordner</b> deines Google Drives gespeichert (Berechtigung
        „drive.appdata“: RepLab sieht keine anderen Dateien). Beim Start wird geladen, nach Änderungen hochgeladen; bei Konflikten gewinnt pro Zug/Karte der neuere
        Stand. Der Lichess-Token wird nie synchronisiert.
      </p>

      {!builtIn && (
        <label className="field">
          <span>
            Google OAuth Client-ID (<a href={SETUP_URL} target="_blank" rel="noreferrer">Einrichtung, 5 Minuten</a>)
          </span>
          <div className="row-actions">
            <input
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              onBlur={() => {
                setGoogleClientId(cid);
                refreshSyncConfig();
              }}
              placeholder="1234-abc.apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </label>
      )}

      <p className="sync-status">
        Status: <b className={`st-${sync.status}`}>{syncTitle(sync)}</b>
      </p>

      <div className="row-actions wrap">
        {!sync.connected ? (
          <button className="btn primary" disabled={!sync.configured} onClick={() => void connectSync()}>
            Mit Google verbinden
          </button>
        ) : (
          <>
            <button className="btn primary" disabled={sync.status === 'syncing'} onClick={() => void syncNow(true)}>
              {sync.status === 'needs-auth' ? 'Neu verbinden & synchronisieren' : 'Jetzt synchronisieren'}
            </button>
            <button className="btn ghost" onClick={disconnectSync}>Trennen</button>
          </>
        )}
      </div>
      <p className="hint">
        Hinweis: Google gibt im Browser nur Zugänge für ca. 1 Stunde aus. Danach zeigt das Wolken-Symbol oben „!“ – einmal tippen genügt. Änderungen gehen
        dazwischen nicht verloren, sie werden beim nächsten Sync nachgereicht.
      </p>
    </section>
  );
}
