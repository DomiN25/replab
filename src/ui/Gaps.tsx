// „Baustellen“: alle Lücken, gruppiert nach Eröffnungsfamilie (F3).
import { useMemo, useState } from 'react';
import { gapList, groupGaps, type GapSort } from '../core/graph';
import { formatLine, displaySan } from '../core/chess';
import { deleteMyMoves, gotoNode, lichessToken, requestGraph, setView, toast, useApp, engine } from './store';
import { Modal } from './Modal';
import { repo } from '../data/repo';
import { effectiveDepth } from '../services/engine';

export function Gaps() {
  const graph = useApp((s) => s.graph);
  const moves = useApp((s) => s.moves);
  const settings = useApp((s) => s.settings);
  const scanQueued = useApp((s) => s.scanQueued);
  const status = useApp((s) => s.explorerStatus);
  const [sort, setSort] = useState<GapSort>('depth');
  const [onlyTraps, setOnlyTraps] = useState(false);
  const [minReach, setMinReach] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('replab.gapMinReach') ?? 0);
    } catch {
      return 0;
    }
  });
  const [askOrphans, setAskOrphans] = useState(false);
  const [engineScan, setEngineScan] = useState<{ done: number; total: number } | undefined>();
  const notation = settings.ui.notation;

  const groups = useMemo(() => {
    if (!graph) return [];
    let list = gapList(graph, sort);
    if (onlyTraps) list = list.filter((g) => g.viaTrap);
    if (minReach > 0) list = list.filter((g) => g.reach >= minReach);
    return groupGaps(list);
  }, [graph, sort, onlyTraps, minReach]);
  const shown = groups.reduce((s, g) => s + g.gaps.length, 0);

  if (!graph) return <p className="hint pad">Repertoire wird berechnet …</p>;

  const total = graph.gaps.length;
  const jump = (id: number) => {
    gotoNode(id);
    setView('build');
  };

  // Tiefe Linien ohne Datenbank-Partien: Engine-Regel braucht eine Analyse
  const runEngineScan = async () => {
    const ids = graph.needsEngine.slice(0, 30);
    setEngineScan({ done: 0, total: ids.length });
    const depth = Math.min(effectiveDepth(settings.engine.depth), 16);
    for (let i = 0; i < ids.length; i++) {
      const n = graph.nodes[ids[i]];
      const h = engine().analyse(n.fen, { depth, multipv: 3 }, () => {});
      const res = await h.done;
      if (res) await repo.putEngine(res);
      setEngineScan({ done: i + 1, total: ids.length });
    }
    setEngineScan(undefined);
    requestGraph(0);
    toast('Engine-Prüfung fertig', 'ok');
  };

  return (
    <div className="page gaps-page">
      <header className="page-head">
        <h1>
          Baustellen <span className="count gap">{total}</span>
          {shown !== total && <small className="shown"> {shown} angezeigt</small>}
        </h1>
        <div className="tools">
          <label className="field inline">
            <span>Sortieren</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as GapSort)}>
              <option value="depth">nach Tiefe</option>
              <option value="reach">nach Erreichwahrscheinlichkeit</option>
              <option value="name">nach Name</option>
            </select>
          </label>
          <label className="field inline">
            <span>Mind. erreicht</span>
            <select
              value={minReach}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMinReach(v);
                try {
                  localStorage.setItem('replab.gapMinReach', String(v));
                } catch {
                  /* egal */
                }
              }}
            >
              <option value={0}>alle</option>
              <option value={0.001}>≥ 0,1 %</option>
              <option value={0.005}>≥ 0,5 %</option>
              <option value={0.01}>≥ 1 %</option>
              <option value={0.02}>≥ 2 %</option>
            </select>
          </label>
          {settings.ui.showTraps && (
            <label className="check">
              <input type="checkbox" checked={onlyTraps} onChange={(e) => setOnlyTraps(e.target.checked)} /> nur nach ⚡ Fallenzügen
            </label>
          )}
        </div>
      </header>

      {graph.pending.length > 0 && (
        <div className="notice">
          {lichessToken() ? (
            <>
              ⏳ {graph.pending.length} Gegnerstellungen warten auf Datenbank-Daten
              {scanQueued > 0 ? ` (lädt, ${scanQueued} in der Warteschlange)` : ''}. Neue Lücken erscheinen automatisch.
              {status.state === 'backoff' && ' Lichess-Limit: kurze Pause.'}
            </>
          ) : (
            <>
              ⏳ {graph.pending.length} Gegnerstellungen ohne Datenbank-Daten. Ohne Lichess-Token zählen dort nur deine eigenen Markierungen (z. B. aus dem PGN-Import).{' '}
              <button className="link-btn" onClick={() => setView('settings')}>Token eintragen</button>
            </>
          )}
        </div>
      )}
      {graph.needsEngine.length > 0 && (
        <div className="notice">
          🔎 {graph.needsEngine.length} tiefe Stellungen haben zu wenige Partien – dort gilt nur die Engine-Regel.{' '}
          {engineScan ? (
            <span>Analysiere {engineScan.done}/{engineScan.total} …</span>
          ) : (
            <button className="btn small" onClick={() => void runEngineScan()}>Engine-Prüfung starten</button>
          )}
        </div>
      )}

      {total === 0 && <p className="empty">Keine Lücken – stark! (Oder es fehlen noch Daten, siehe oben.)</p>}

      <div className="gap-groups">
        {groups.map((g) => (
          <section key={g.family} className="gapfam">
            <h2>
              {g.family} <small>{g.gaps.length}</small>
            </h2>
            <ul>
              {g.gaps.map((gp) => (
                <li key={gp.id}>
                  <button onClick={() => jump(gp.id)}>
                    <span className="line">{formatLine(gp.sans, notation)}</span>
                    <span className="meta">
                      {gp.viaTrap && settings.ui.showTraps && <span className="trap" title="Gegnerzug ist eine Chance (Fehler)">⚡</span>}
                      {gp.name && gp.name !== g.family && <span className="nm">{gp.name}</span>}
                      {settings.ui.showReach && gp.reach > 0 && <span className="reach">≈ {(gp.reach * 100).toFixed(1)} %</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {graph.orphans.length > 0 && (
        <section className="orphans">
          <h2>Verwaiste Einträge <small>{graph.orphans.length}</small></h2>
          <p className="hint">Eigene Züge in Stellungen, die über dein Repertoire nicht (mehr) erreichbar sind – z. B. nach dem Ändern eines Zugs.</p>
          <ul>
            {graph.orphans.slice(0, 30).map((k) => {
              const m = moves.get(k);
              return <li key={k}>{m ? `${displaySan(m.san, notation)} in ${k.split(' ')[0]}` : k}</li>;
            })}
          </ul>
          <button className="btn danger small" onClick={() => setAskOrphans(true)}>Alle verwaisten Einträge löschen</button>
        </section>
      )}
      {askOrphans && (
        <Modal
          title="Verwaiste Einträge löschen?"
          onClose={() => setAskOrphans(false)}
          actions={[
            { label: `${graph.orphans.length} löschen`, kind: 'danger', onClick: () => { void deleteMyMoves(graph.orphans); setAskOrphans(false); } },
            { label: 'Abbrechen', kind: 'ghost', onClick: () => setAskOrphans(false) },
          ]}
        >
          <p>Die Einträge und ihr Lernstand werden endgültig gelöscht.</p>
        </Modal>
      )}
      <p className="hint small">
        Regel: Gegnerzug relevant bei ≥ {Math.round(settings.explorer.minShare * 100)} % Anteil und ≥ {settings.explorer.minGames} Partien
        (Ratingband {settings.explorer.ratings.join('+')}, {settings.explorer.speeds.join('/')}) oder Engine-Top-3 mit ≤ {settings.engine.nearBestCp} cp
        Abstand, plus deine Markierungen. Berechnung: {graph.nodes.length} Knoten.
      </p>
    </div>
  );
}
