// Startseite (Dashboard): Training, Lücken, Wissensleisten pro Familie, Statistik, zuletzt bearbeitet.
import { useEffect, useMemo, useState } from 'react';
import { currentRep, gotoPosKey, loadRepData, reloadRepertoires, selectRepertoire, setView, toast, useApp } from './store';
import { repo } from '../data/repo';
import { knowledgeOf, Scheduler, trainingStats } from '../core/srs';
import { buildPool, dueItems, newItems } from './training';
import { KNOWLEDGE_COLORS } from './knowledge';
import { displaySan } from '../core/chess';
import { loadSeedRepertoires, fetchSeed, seedAvailable, importPgnFiles } from './seed';
import { connectSync } from './sync';
import { ImportDialog, type ImportPreset } from './ImportDialog';
import { downloadBackup, lastBackupAt } from './backup';
import type { ReviewLog } from '../core/types';
import type { BackupFile } from '../data/repo';
import { gapCounts } from '../core/graph';
import { pct } from './format';

export function Home() {
  const rep = currentRep();
  const repertoires = useApp((s) => s.repertoires);
  const graph = useApp((s) => s.graph);
  const cards = useApp((s) => s.cards);
  const moves = useApp((s) => s.moves);
  const settings = useApp((s) => s.settings);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  // Warteschlange für Importdialoge (Dateien mit Konflikten nacheinander)
  const [presets, setPresets] = useState<ImportPreset[]>([]);
  const sync = useApp((s) => s.sync);
  const [loadingPgn, setLoadingPgn] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [hasSeed, setHasSeed] = useState<boolean | undefined>();

  useEffect(() => {
    if (!repertoires.length) void seedAvailable().then(setHasSeed);
  }, [repertoires.length]);

  const importBackupFile = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as BackupFile;
      await repo.importAll(data);
      await reloadRepertoires();
      const reps = useApp.getState().repertoires;
      const first = reps.find((r) => r.isMain && r.color === 'white') ?? reps[0];
      if (first) await selectRepertoire(first.id);
      toast(`Sicherung eingespielt: ${data.moves.length} Einträge`, 'ok');
    } catch (e) {
      toast(`Sicherung konnte nicht gelesen werden: ${String(e)}`, 'err');
    }
  };

  useEffect(() => {
    void repo.reviewsSince(Date.now() - 400 * 86400_000).then(setLogs);
  }, [cards]);

  const now = Date.now();
  const cardList = useMemo(() => [...cards.values()], [cards]);
  const pool = useMemo(() => buildPool(cardList, logs, settings, now, graph), [cardList, logs, settings, graph, now]);
  const dueCount = useMemo(() => dueItems(pool, settings, now, graph).length, [pool, settings, now, graph]);
  const newCount = useMemo(() => newItems(pool, settings, graph).length, [pool, settings, graph]);
  const gapMin = settings.ui.gapMinReach;
  const gapInfo = useMemo(() => (graph ? gapCounts(graph, gapMin) : undefined), [graph, gapMin]);
  const stats = useMemo(() => trainingStats(logs.filter((l) => l.repertoireId === rep?.id), now), [logs, rep, now]);

  // Wissensleiste pro Familie
  const bars = useMemo(() => {
    if (!graph) return [];
    const sch = new Scheduler(settings.srs.desiredRetention);
    const m = new Map<string, { green: number; yellow: number; red: number; grey: number; gap: number }>();
    for (const n of graph.nodes) {
      if (n.status === 'transposition' || n.toMove !== 'me' || n.ply === 0) continue;
      const fam = n.topFamily;
      const b = m.get(fam) ?? { green: 0, yellow: 0, red: 0, grey: 0, gap: 0 };
      if (n.status === 'gap') b.gap++;
      else if (n.status === 'answered') {
        const c = cards.get(n.posKey);
        b[knowledgeOf(c ? sch.retrievability(c.srs, now) : undefined)]++;
      }
      m.set(fam, b);
    }
    return [...m.entries()]
      .map(([fam, b]) => ({ fam, ...b, total: b.green + b.yellow + b.red + b.grey + b.gap }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [graph, cards, settings.srs.desiredRetention, now]);

  const recent = useMemo(() => [...moves.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), [moves]);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await loadSeedRepertoires();
      await reloadRepertoires();
      await selectRepertoire(r.whiteId);
      toast(`Startrepertoire geladen: ${r.entries} Einträge`, 'ok');
      // Studie Spanisch: über den Importdialog, damit Konflikte (5.O-O vs 5.d3) abgefragt werden
      setPresets([{ text: await fetchSeed('studie_spanisch.pgn'), name: 'studie_spanisch.pgn', repId: r.whiteId, source: 'seed' }]);
    } catch (e) {
      toast(`Seed fehlgeschlagen: ${String(e)}`, 'err');
    } finally {
      setSeeding(false);
    }
  };

  const loadPgnFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setLoadingPgn(true);
    try {
      const r = await importPgnFiles([...list]);
      await reloadRepertoires();
      if (r.firstRepId) await selectRepertoire(r.firstRepId);
      toast(`${r.imported} Einträge übernommen${r.pending.length ? ` – ${r.pending.length} Datei(en) mit Konflikten folgen` : ''}`, 'ok');
      setPresets(r.pending);
    } catch (e) {
      toast(`PGN konnte nicht geladen werden: ${String(e)}`, 'err');
    } finally {
      setLoadingPgn(false);
    }
  };

  const dialog = presets[0] && <ImportDialog key={presets[0].name} preset={presets[0]} onClose={() => setPresets((p) => p.slice(1))} />;

  const backupDue = repertoires.length > 0 && now - lastBackupAt() > 7 * 86400_000;

  if (!repertoires.length) {
    return (
      <div className="page home">
        <section className="welcome">
          <h1>Willkommen bei Rep<span>Lab</span></h1>
          <p>Baue dein Eröffnungsrepertoire Zug für Zug, finde Lücken und lerne es mit verteilter Wiederholung.</p>
          <div className="welcome-steps">
            {sync.configured && (
              <div className="wstep">
                <h2>Schon Daten auf einem anderen Gerät?</h2>
                <button className="btn primary big" disabled={sync.status === 'syncing'} onClick={() => void connectSync()}>
                  {sync.status === 'syncing' ? 'Synchronisiere …' : 'Mit Google Drive verbinden'}
                </button>
                <p className="hint">Holt Repertoire und Lernstand aus deinem Google Drive.</p>
              </div>
            )}
            <div className="wstep">
              <h2>Erstes Gerät?</h2>
              {hasSeed ? (
                <button className="btn primary big" disabled={seeding} onClick={() => void seed()}>{seeding ? 'Lade …' : 'Startrepertoire laden'}</button>
              ) : (
                <label className={`btn big file ${sync.configured ? '' : 'primary'}`} aria-disabled={loadingPgn}>
                  {loadingPgn ? 'Lade …' : 'Repertoire aus PGN-Dateien laden'}
                  <input type="file" accept=".pgn,application/x-chess-pgn,text/plain" multiple hidden onChange={(e) => void loadPgnFiles(e.target.files)} />
                </label>
              )}
              <p className="hint">
                {hasSeed
                  ? 'Deine Repertoire-Karte Weiß und Schwarz; danach die Studie „Spanisch“ mit Konfliktabfrage.'
                  : 'Mehrere Dateien auf einmal wählen, z. B. repertoire_weiss.pgn, repertoire_schwarz.pgn und studie_spanisch.pgn. Die Farbe kommt aus der Datei; bei Widersprüchen wirst du gefragt.'}
                {sync.configured && ' Danach unter Einstellungen mit Google Drive verbinden.'}
              </p>
            </div>
          </div>
          <div className="row-actions center">
            <label className="btn file ghost">
              Sicherung einspielen (JSON)
              <input type="file" accept="application/json,.json" hidden onChange={(e) => void importBackupFile(e.target.files?.[0])} />
            </label>
            <button className="btn ghost" onClick={() => setView('settings')}>Leeres Repertoire anlegen</button>
          </div>
        </section>
        {dialog}
      </div>
    );
  }

  return (
    <div className="page home">
      <div className="dash">
        <section className="card train">
          <h2>Training</h2>
          <div className="big-nums">
            <div><b>{dueCount}</b><span>fällig</span></div>
            <div><b>{newCount}</b><span>neu (heute)</span></div>
          </div>
          <button
            className="btn primary big"
            onClick={() => {
              useApp.setState({ trainAuto: true });
              setView('train');
            }}
          >
            {dueCount > 0 ? 'Wiederholen starten' : newCount > 0 ? 'Neue lernen' : 'Zum Training'}
          </button>
        </section>

        <section className="card gaps">
          <h2>Lücken</h2>
          <div className="big-nums">
            <div><b className="gap">{gapInfo ? gapInfo.important : '…'}</b><span>wichtig (≥ {pct(gapMin)})</span></div>
            {gapInfo && gapInfo.rare > 0 && <div><b className="muted-num">{gapInfo.rare}</b><span>selten</span></div>}
            {graph && graph.pending.length > 0 && <div><b className="muted-num">{graph.pending.length}</b><span>warten auf Daten</span></div>}
          </div>
          <button className="btn big" onClick={() => setView('gaps')}>Lücken ansehen</button>
        </section>

        <section className="card stats">
          <h2>Statistik</h2>
          <ul className="kv">
            <li><span>Heute gelernt</span><b>{stats.reviewsToday}</b></li>
            <li><span>Trefferquote 7 Tage</span><b>{stats.hitRate7 !== undefined ? `${Math.round(stats.hitRate7 * 100)} %` : '–'}</b></li>
            <li><span>Trefferquote 30 Tage</span><b>{stats.hitRate30 !== undefined ? `${Math.round(stats.hitRate30 * 100)} %` : '–'}</b></li>
            <li><span>Serie</span><b>{stats.streak} {stats.streak === 1 ? 'Tag' : 'Tage'}</b></li>
            <li><span>Einträge</span><b>{moves.size}</b></li>
          </ul>
        </section>

        <section className="card knowledge">
          <h2>Wissen pro Familie</h2>
          {bars.length === 0 && <p className="hint">Noch keine Daten.</p>}
          {bars.map((b) => (
            <div key={b.fam} className="kbar-row">
              <span className="kbar-label">{b.fam}</span>
              <span className="kbar" title={`grün ${b.green} · gelb ${b.yellow} · rot ${b.red} · neu ${b.grey} · Lücken ${b.gap}`}>
                {(['green', 'yellow', 'red', 'grey'] as const).map((k) => (b[k] ? <i key={k} style={{ flex: b[k], background: KNOWLEDGE_COLORS[k] }} /> : null))}
                {b.gap ? <i className="stripes" style={{ flex: b.gap }} /> : null}
              </span>
              <span className="kbar-n">{b.total}</span>
            </div>
          ))}
        </section>

        <section className="card recent">
          <h2>Zuletzt bearbeitet</h2>
          <ul className="recent-list">
            {recent.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => {
                    gotoPosKey(m.posKey, m.fen);
                    setView('build');
                  }}
                >
                  <b className="me">{displaySan(m.san, settings.ui.notation)}</b>
                  <span>{graph?.nodes[graph.byPosKey.get(m.posKey) ?? -1]?.name ?? ''}</span>
                  <small>{new Date(m.updatedAt).toLocaleDateString('de-DE')}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {sync.configured && !sync.connected && (
          <section className="card sync-card">
            <h2>Sync einrichten</h2>
            <p className="hint">Verbinde Google Drive, damit Handy und PC denselben Stand haben (versteckter App-Ordner, nur RepLab-Daten).</p>
            <button className="btn primary" onClick={() => void connectSync()}>Mit Google Drive verbinden</button>
          </section>
        )}

        {backupDue && (
          <section className="card backup">
            <h2>Sicherung</h2>
            <p className="hint">Letzte JSON-Sicherung ist über 7 Tage her (oder noch nie). Daten liegen nur in diesem Browser.</p>
            <button className="btn" onClick={() => void downloadBackup().then(() => void loadRepData())}>Jetzt sichern</button>
          </section>
        )}
      </div>
      {dialog}
    </div>
  );
}
