// Einstellungen (F10), Repertoire-Verwaltung, Import/Export.
import { useEffect, useRef, useState } from 'react';
import { repo, type BackupFile } from '../data/repo';
import { currentRep, loadRepData, reloadRepertoires, saveSettings, selectRepertoire, setView, toast, useApp } from './store';
import { ImportDialog, type ImportPreset } from './ImportDialog';
import { Modal } from './Modal';
import { downloadBackup, downloadPgn } from './backup';
import { fetchSeed, loadSeedRepertoires, seedAvailable } from './seed';
import { SyncSettings } from './SyncSettings';
import type { Color, Settings } from '../core/types';
import { BOARD_THEMES, useAppearance, type ThemeMode } from './theme';
import { Icon, type IconName } from './Icon';
import { RowMenu } from './RowMenu';
import { clearMyGames, loadMyGames, useMyGames } from './games';

const MODES: { id: ThemeMode; label: string; icon: IconName }[] = [
  { id: 'auto', label: 'System', icon: 'auto' },
  { id: 'light', label: 'Hell', icon: 'sun' },
  { id: 'dark', label: 'Dunkel', icon: 'moon' },
];

const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const RATINGS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

export function SettingsView() {
  const settings = useApp((s) => s.settings);
  const repertoires = useApp((s) => s.repertoires);
  const graph = useApp((s) => s.graph);
  const moves = useApp((s) => s.moves);
  const marks = useApp((s) => s.marks);
  const [showToken, setShowToken] = useState(false);
  const [importPreset, setImportPreset] = useState<ImportPreset | undefined>();
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => Promise<void>; label: string } | undefined>();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<Color>('white');
  const rep = currentRep();
  const look = useAppearance();
  // Entwickler-Knöpfe (Startrepertoire aus public/seed/) nur, wo es die Dateien gibt – live nicht
  const [hasSeed, setHasSeed] = useState(false);
  // Ohne Token läuft die Datenbank nicht → Abschnitt dann gleich offen (nur beim Öffnen der Seite entschieden)
  const [lichessOpen] = useState(() => !settings.explorer.token);
  useEffect(() => {
    void seedAvailable().then(setHasSeed);
  }, []);

  const upd = (fn: (s: Settings) => void) => {
    const s = structuredClone(settings);
    fn(s);
    const msg = clamped.current ?? 'Gespeichert';
    clamped.current = undefined;
    if (JSON.stringify(s) === JSON.stringify(settings)) {
      if (msg !== 'Gespeichert') toast(msg, 'info'); // begrenzt, aber gleicher Wert wie vorher
      return; // sonst: nichts geändert → keine Meldung
    }
    void saveSettings(s).then(() => toast(msg, 'ok'));
  };
  // Eingabe außerhalb des erlaubten Bereichs: begrenzen und das sagen (statt still zu korrigieren)
  const clamped = useRef<string | undefined>(undefined);
  const num = (v: string, min: number, max: number) => {
    const raw = Number(v);
    const val = Math.min(max, Math.max(min, Number.isFinite(raw) && v.trim() !== '' ? raw : min));
    clamped.current = val !== raw ? `Gespeichert – erlaubt ist ${min} bis ${max}, also ${val}` : undefined;
    return val;
  };

  const create = async () => {
    if (!newName.trim()) return;
    const r = await repo.createRepertoire(newName.trim(), newColor);
    await reloadRepertoires();
    await selectRepertoire(r.id);
    setNewName('');
    toast('Repertoire angelegt', 'ok');
  };

  const importBackup = async (f?: File) => {
    if (!f) return;
    let data: BackupFile;
    try {
      data = JSON.parse(await f.text());
    } catch {
      toast('Datei ist kein gültiges JSON', 'err');
      return;
    }
    setConfirm({
      title: 'Sicherung einspielen?',
      text: `Alle Repertoires, Karten und Lernhistorie in diesem Browser werden durch die Sicherung vom ${new Date(data.exportedAt).toLocaleString('de-DE')} ersetzt. Token und Caches bleiben.`,
      label: 'Ersetzen',
      action: async () => {
        await repo.importAll(data);
        await reloadRepertoires();
        const s = useApp.getState();
        if (s.repId) await loadRepData();
        toast('Sicherung eingespielt', 'ok');
      },
    });
  };

  return (
    <div className="page settings">
      <h1>Einstellungen</h1>

      <section className="card">
        <h2>Repertoires</h2>
        <ul className="rep-list">
          {repertoires.map((r) => (
            <li key={r.id} className={r.id === rep?.id ? 'current' : ''}>
              <span className={`kdot ${r.color}`} aria-hidden />
              <input
                className="rep-name"
                defaultValue={r.name}
                aria-label={`Name von ${r.name} (antippen zum Umbenennen)`}
                onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && void repo.renameRepertoire(r.id, e.target.value.trim()).then(reloadRepertoires)}
              />
              {r.id === rep?.id && <span className="tag rep">aktiv</span>}
              {r.isMain && <span className="tag ok">Haupt</span>}
              <RowMenu label={`Aktionen für ${r.name}`}>
              <button onClick={() => void selectRepertoire(r.id)} disabled={r.id === rep?.id}>Öffnen</button>
              {!r.isMain && <button onClick={() => void repo.setMain(r.id).then(reloadRepertoires)}>Als Hauptrepertoire</button>}
              <button
                onClick={() =>
                  setConfirm({
                    title: `„${r.name}“ leeren?`,
                    text: 'Alle Einträge, Markierungen, Karten und die Lernhistorie dieses Repertoires werden gelöscht. Das Repertoire selbst bleibt (zum Neu-Festlegen).',
                    label: 'Leeren',
                    action: async () => {
                      await repo.clearRepertoire(r.id);
                      await loadRepData();
                      toast('Repertoire geleert', 'ok');
                    },
                  })
                }
              >
                Leeren …
              </button>
              <button
                className="danger"
                onClick={() =>
                  setConfirm({
                    title: `„${r.name}“ löschen?`,
                    text: 'Repertoire inkl. aller Einträge, Karten und Lernhistorie wird endgültig gelöscht. Tipp: vorher eine JSON-Sicherung machen.',
                    label: 'Löschen',
                    action: async () => {
                      await repo.deleteRepertoire(r.id);
                      await reloadRepertoires();
                      toast('Repertoire gelöscht', 'ok');
                    },
                  })
                }
              >
                Löschen …
              </button>
              </RowMenu>
            </li>
          ))}
        </ul>
        <div className="row-actions rep-new">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, z. B. Zweitwaffe 1.d4" aria-label="Name des neuen Repertoires" />
          <select value={newColor} onChange={(e) => setNewColor(e.target.value as Color)} aria-label="Farbe">
            <option value="white">Weiß</option>
            <option value="black">Schwarz</option>
          </select>
          <button className="btn primary" onClick={() => void create()}>Anlegen</button>
        </div>
      </section>

      <SyncSettings />

      <section className="card">
        <h2>Daten</h2>
        <div className="list">
          <button
            className="list-row"
            onClick={() => {
              useApp.setState({ studyId: undefined, studyAdd: true });
              setView('studies');
            }}
          >
            <Icon name="book" />
            <span><b>Studie hinzufügen</b><small>erst ansehen und zuschneiden, dann übernehmen</small></span>
            <Icon name="next" className="chev" />
          </button>
          <button className="list-row" onClick={() => setImportPreset({ text: '', name: '' })}>
            <Icon name="upload" />
            <span><b>PGN direkt ins Repertoire</b><small>Datei oder Text, mit Konfliktabfrage</small></span>
            <Icon name="next" className="chev" />
          </button>
          <button className="list-row" disabled={!rep || !graph} onClick={() => rep && graph && downloadPgn(rep, graph, moves, marks)}>
            <Icon name="download" />
            <span><b>PGN exportieren</b><small>{rep?.name ?? '–'}</small></span>
          </button>
          <button className="list-row" onClick={() => void downloadBackup()}>
            <Icon name="download" />
            <span><b>JSON-Sicherung exportieren</b><small>alles außer Lichess-Token und Caches</small></span>
          </button>
          <label className="list-row">
            <Icon name="upload" />
            <span><b>JSON-Sicherung einspielen</b><small>ersetzt die Daten in diesem Browser (mit Rückfrage)</small></span>
            <input type="file" accept="application/json,.json" onChange={(e) => void importBackup(e.target.files?.[0])} hidden />
          </label>
        </div>
        {hasSeed && (
        <div className="row-actions wrap">
          <button
            className="btn ghost"
            onClick={() =>
              setConfirm({
                title: 'Startrepertoire laden?',
                text: 'Importiert repertoire_weiss.pgn und repertoire_schwarz.pgn in die Hauptrepertoires (vorhandene Züge bleiben, nur Neues kommt dazu).',
                label: 'Laden',
                action: async () => {
                  const r = await loadSeedRepertoires();
                  await reloadRepertoires();
                  await loadRepData();
                  toast(`+${r.entries} Einträge`, 'ok');
                },
              })
            }
          >
            Startrepertoire laden
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              try {
                setImportPreset({ text: await fetchSeed('studie_spanisch.pgn'), name: 'studie_spanisch.pgn', source: 'seed', repId: repertoires.find((r) => r.color === 'white' && r.isMain)?.id });
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), 'err');
              }
            }}
          >
            Studie „Spanisch“ importieren
          </button>
        </div>
        )}
      </section>

      <details className="card fold" open={lichessOpen}>
        <summary>
          <h2>Lichess-Datenbank</h2>
          <small>Token, Bedenkzeiten, Ratingbänder</small>
          <Icon name="next" className="fold-ico" />
        </summary>
        <label className="field">
          <span>Persönlicher Token (nur lokal gespeichert, nie exportiert)</span>
          <div className="row-actions">
            <input
              type={showToken ? 'text' : 'password'}
              defaultValue={settings.explorer.token ?? ''}
              placeholder="lip_…"
              autoComplete="off"
              onBlur={(e) => upd((s) => (s.explorer.token = e.target.value.trim() || undefined))}
            />
            <button className="btn small ghost" onClick={() => setShowToken(!showToken)}>{showToken ? 'verbergen' : 'zeigen'}</button>
          </div>
        </label>
        <p className="hint">
          Token anlegen: <a href="https://lichess.org/account/oauth/token/create" target="_blank" rel="noreferrer">lichess.org → API-Token</a> (keine Rechte nötig).
          {typeof __DEV_LICHESS_TOKEN__ !== 'undefined' && __DEV_LICHESS_TOKEN__ && !settings.explorer.token ? ' Aktuell wird der Entwicklungs-Token aus .env.local genutzt.' : ''}
        </p>
        <fieldset className="checks">
          <legend>Bedenkzeiten</legend>
          {SPEEDS.map((sp) => (
            <label key={sp} className="check">
              <input
                type="checkbox"
                checked={settings.explorer.speeds.includes(sp)}
                onChange={(e) => upd((s) => (s.explorer.speeds = e.target.checked ? [...s.explorer.speeds, sp] : s.explorer.speeds.filter((x) => x !== sp)))}
              />
              {sp}
            </label>
          ))}
        </fieldset>
        <fieldset className="checks">
          <legend>Ratingbänder (Untergrenzen)</legend>
          {RATINGS.map((r) => (
            <label key={r} className="check">
              <input
                type="checkbox"
                checked={settings.explorer.ratings.includes(r)}
                onChange={(e) => upd((s) => (s.explorer.ratings = (e.target.checked ? [...s.explorer.ratings, r] : s.explorer.ratings.filter((x) => x !== r)).sort((a, b) => a - b)))}
              />
              {r}
            </label>
          ))}
        </fieldset>
        <div className="grid2">
          <label className="field">
            <span>Mindestanteil relevanter Gegnerzüge (%)</span>
            <input type="number" min={1} max={50} defaultValue={Math.round(settings.explorer.minShare * 100)} onBlur={(e) => upd((s) => (s.explorer.minShare = num(e.target.value, 1, 50) / 100))} />
          </label>
          <label className="field">
            <span>Mindestpartien</span>
            <input type="number" min={1} max={1000} defaultValue={settings.explorer.minGames} onBlur={(e) => upd((s) => (s.explorer.minGames = num(e.target.value, 1, 1000)))} />
          </label>
        </div>
      </details>

      <MyGamesCard settings={settings} upd={upd} />

      <details className="card fold">
        <summary>
          <h2>Engine</h2>
          <small>für Fortgeschrittene</small>
          <Icon name="next" className="fold-ico" />
        </summary>
        <div className="grid2">
          <label className="field">
            <span>Tiefe (Handy max. 14)</span>
            <input type="number" min={8} max={26} defaultValue={settings.engine.depth} onBlur={(e) => upd((s) => (s.engine.depth = num(e.target.value, 8, 26)))} />
          </label>
          <label className="field">
            <span>Linien (MultiPV)</span>
            <input type="number" min={1} max={5} defaultValue={settings.engine.multipv} onBlur={(e) => upd((s) => (s.engine.multipv = num(e.target.value, 1, 5)))} />
          </label>
          <label className="field">
            <span>Engine-Regel: max. Abstand zum Besten (cp)</span>
            <input type="number" min={0} max={300} defaultValue={settings.engine.nearBestCp} onBlur={(e) => upd((s) => (s.engine.nearBestCp = num(e.target.value, 0, 300)))} />
          </label>
          <label className="field">
            <span>Falle: Mindestverlust (cp)</span>
            <input type="number" min={30} max={500} defaultValue={settings.engine.trapLossCp} onBlur={(e) => upd((s) => (s.engine.trapLossCp = num(e.target.value, 30, 500)))} />
          </label>
        </div>
      </details>

      <details className="card fold">
        <summary>
          <h2>Training</h2>
          <small>Neue Karten pro Tag, Reihenfolge, Behaltensziel</small>
          <Icon name="next" className="fold-ico" />
        </summary>
        <div className="grid2">
          <label className="field">
            <span>Behaltensziel (0,80–0,97)</span>
            <input type="number" step={0.01} min={0.8} max={0.97} defaultValue={settings.srs.desiredRetention} onBlur={(e) => upd((s) => (s.srs.desiredRetention = Math.min(0.97, Math.max(0.8, Number(e.target.value) || 0.9))))} />
          </label>
          <label className="field">
            <span>Neue Karten pro Tag</span>
            <input type="number" min={0} max={500} defaultValue={settings.srs.newPerDay} onBlur={(e) => upd((s) => (s.srs.newPerDay = num(e.target.value, 0, 500)))} />
          </label>
          <label className="field">
            <span>Reihenfolge neuer Karten</span>
            <select value={settings.srs.newOrder} onChange={(e) => upd((s) => (s.srs.newOrder = e.target.value as 'reach' | 'line'))}>
              <option value="reach">wichtigste zuerst (häufigste Stellungen)</option>
              <option value="line">Linie für Linie</option>
            </select>
          </label>
          <label className="field">
            <span>Neue Karten erst ab Erreichbarkeit</span>
            <select value={settings.srs.newMinReach} onChange={(e) => upd((s) => (s.srs.newMinReach = Number(e.target.value)))}>
              <option value={0}>alle</option>
              <option value={0.001}>≥ 0,1 %</option>
              <option value={0.005}>≥ 0,5 %</option>
              <option value={0.01}>≥ 1 %</option>
              <option value={0.02}>≥ 2 %</option>
            </select>
          </label>
          <label className="field">
            <span>Max. Wiederholungen pro Tag</span>
            <input type="number" min={10} max={2000} defaultValue={settings.srs.maxReviewsPerDay} onBlur={(e) => upd((s) => (s.srs.maxReviewsPerDay = num(e.target.value, 10, 2000)))} />
          </label>
          <label className="field">
            <span>Kontext-Halbzüge</span>
            <input type="number" min={0} max={12} defaultValue={settings.srs.contextPlies} onBlur={(e) => upd((s) => (s.srs.contextPlies = num(e.target.value, 0, 12)))} />
          </label>
          <label className="field">
            <span>„Easy“ unter … Sekunden</span>
            <input type="number" min={1} max={30} defaultValue={settings.srs.easyMs / 1000} onBlur={(e) => upd((s) => (s.srs.easyMs = num(e.target.value, 1, 30) * 1000))} />
          </label>
          <label className="field">
            <span>„Hard“ über … Sekunden</span>
            <input type="number" min={5} max={120} defaultValue={settings.srs.hardMs / 1000} onBlur={(e) => upd((s) => (s.srs.hardMs = num(e.target.value, 5, 120) * 1000))} />
          </label>
        </div>
      </details>

      <details className="card fold" open>
        <summary>
          <h2>Anzeige</h2>
          <Icon name="next" className="fold-ico" />
        </summary>
        <div className="appearance-row">
          <span>Farbschema</span>
          <div className="seg" role="group" aria-label="Farbschema">
            {MODES.map((m) => (
              <button key={m.id} aria-pressed={look.mode === m.id} onClick={() => look.setMode(m.id)}>
                <Icon name={m.icon} />
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-row">
          <span>Brett</span>
          <div className="board-picks" role="group" aria-label="Brettfarben">
            {BOARD_THEMES.map((b) => (
              <button key={b.id} className="board-pick" aria-pressed={look.board === b.id} onClick={() => look.setBoard(b.id)}>
                <i style={{ backgroundImage: `conic-gradient(${b.sq[1]} 0 90deg, ${b.sq[0]} 0 180deg, ${b.sq[1]} 0 270deg, ${b.sq[0]} 0)` }} aria-hidden />
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={look.haptics} onChange={(e) => look.setHaptics(e.target.checked)} /> Vibration beim Antworten im Training (Android)
        </label>
        <p className="hint small">Farbschema, Brett und Vibration gelten nur für dieses Gerät.</p>
        <label className="check">
          <input type="checkbox" checked={settings.ui.notation === 'de'} onChange={(e) => upd((s) => (s.ui.notation = e.target.checked ? 'de' : 'en'))} /> Deutsche Notation (S, L, T, D, K)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.ui.evalBar !== false} onChange={(e) => upd((s) => (s.ui.evalBar = e.target.checked))} /> Bewertungsbalken neben dem Brett (Stockfish, im Repertoire und in Studien)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.ui.showReach} onChange={(e) => upd((s) => (s.ui.showReach = e.target.checked))} /> Erreichwahrscheinlichkeit anzeigen
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.ui.showTraps} onChange={(e) => upd((s) => (s.ui.showTraps = e.target.checked))} /> Fallen (<Icon name="bolt" className="trap-ico" />) markieren
        </label>
      </details>

      <details className="card fold">
        <summary>
          <h2>Info</h2>
          <small>Version, Lizenzen</small>
          <Icon name="next" className="fold-ico" />
        </summary>
        <p className="hint">
          RepLab 0.1 · Daten liegen lokal in diesem Browser (IndexedDB). Lizenz GPL-3 (Stockfish, chessground, chessops). Eröffnungsnamen: lichess-org/chess-openings (CC0).
        </p>
      </details>

      {importPreset && <ImportDialog preset={importPreset} onClose={() => setImportPreset(undefined)} />}
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => setConfirm(undefined)}
          actions={[
            {
              label: confirm.label,
              kind: 'danger',
              onClick: () => {
                const c = confirm;
                setConfirm(undefined);
                void c.action().catch((e) => toast(String(e), 'err'));
              },
            },
            { label: 'Abbrechen', kind: 'ghost', onClick: () => setConfirm(undefined) },
          ]}
        >
          <p>{confirm.text}</p>
        </Modal>
      )}
    </div>
  );
}

/** „Meine Partien“: Lichess-Partien laden, damit das Repertoire zeigt, was Gegner tatsächlich gegen mich spielen. */
function MyGamesCard({ settings, upd }: { settings: Settings; upd: (fn: (s: Settings) => void) => void }) {
  const stored = useMyGames();
  const [busy, setBusy] = useState<number | undefined>();
  const [max, setMax] = useState(300);
  const [name, setName] = useState(settings.ui.lichessUser ?? stored?.user ?? '');
  const load = async () => {
    const user = name.trim();
    upd((s) => (s.ui.lichessUser = user || undefined));
    setBusy(0);
    try {
      const n = await loadMyGames(user, max, settings.explorer.token?.trim() || undefined, setBusy);
      toast(n ? `${n} Partien geladen` : 'Keine gewerteten Partien gefunden (Blitz, Rapid, Klassisch, Fernschach).', n ? 'ok' : 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <details className="card fold" data-testid="my-games">
      <summary>
        <h2>Meine Partien (Lichess)</h2>
        <small>{stored ? `${stored.games.length} geladen` : 'was Gegner gegen dich spielen'}</small>
        <Icon name="next" className="fold-ico" />
      </summary>
      <p className="hint">
        Lädt deine gewerteten Partien von Lichess (ohne Token möglich). Im Repertoire erscheint dann bei jedem Gegnerzug, was deine Gegner dort tatsächlich gespielt
        haben, und bei den Lücken, welche in deinen Partien vorkamen. Gespeichert nur auf diesem Gerät.
      </p>
      <label className="field">
        <span>Lichess-Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="dein Benutzername" autoComplete="off" aria-label="Lichess-Name" />
      </label>
      <label className="field inline">
        <span>Anzahl Partien</span>
        <select value={max} onChange={(e) => setMax(Number(e.target.value))} aria-label="Anzahl Partien">
          <option value={100}>letzte 100</option>
          <option value={300}>letzte 300</option>
          <option value={1000}>letzte 1000</option>
        </select>
      </label>
      <div className="row-actions">
        <button className="btn primary" disabled={busy !== undefined || !name.trim()} onClick={() => void load()}>
          {busy !== undefined ? `Lade … ${busy}` : stored ? 'Neu laden' : 'Partien laden'}
        </button>
        {stored && (
          <button className="btn ghost" disabled={busy !== undefined} onClick={clearMyGames}>
            Entfernen
          </button>
        )}
      </div>
      {stored && (
        <p className="hint">
          {stored.games.length} Partien von {stored.user} · Stand {new Date(stored.fetchedAt).toLocaleDateString('de-DE')}
        </p>
      )}
    </details>
  );
}
