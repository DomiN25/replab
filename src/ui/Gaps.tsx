// Lücken: gruppiert nach Eröffnungsfamilie (F3). Standard: nur wichtige (Mindest-Erreichbarkeit aus den Einstellungen).
import { useEffect, useMemo, useRef, useState } from 'react';
import { gapList, groupGaps, type GapSort } from '../core/graph';
import { formatLine, displaySan } from '../core/chess';
import { deleteMyMoves, gotoNode, lichessToken, requestGraph, saveSettings, setEndOfLine, setView, toast, toggleOpp, useApp, engine } from './store';
import { Modal } from './Modal';
import { startGuide } from './GuideBar';
import { repo } from '../data/repo';
import { effectiveDepth } from '../services/engine';
import { Icon } from './Icon';

export function Gaps() {
  const graph = useApp((s) => s.graph);
  const moves = useApp((s) => s.moves);
  const settings = useApp((s) => s.settings);
  const scanQueued = useApp((s) => s.scanQueued);
  const status = useApp((s) => s.explorerStatus);
  const [sort, setSort] = useState<GapSort>('reach');
  const [onlyTraps, setOnlyTraps] = useState(false);
  const minReach = settings.ui.gapMinReach;
  const [askOrphans, setAskOrphans] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
          Lücken <span className="count gap">{shown}</span>
          {shown !== total && <small className="shown"> von {total} – seltenere ausgeblendet</small>}
        </h1>
        <div className="tools">
          <button
            className="btn primary"
            onClick={() => {
              setView('build');
              setTimeout(() => startGuide(), 0);
            }}
          >
            Lückentour starten
          </button>
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
                const s = structuredClone(settings);
                s.ui.gapMinReach = Number(e.target.value);
                void saveSettings(s);
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
              <input type="checkbox" checked={onlyTraps} onChange={(e) => setOnlyTraps(e.target.checked)} /> nur nach <Icon name="bolt" className="trap-ico" /> Fallenzügen
            </label>
          )}
        </div>
      </header>

      {graph.pending.length > 0 && (
        <div className="notice">
          {lichessToken() ? (
            <>
              <Icon name="clock" /> {graph.pending.length} Gegnerstellungen warten auf Datenbank-Daten
              {scanQueued > 0 ? ` (lädt, ${scanQueued} in der Warteschlange)` : ''}. Neue Lücken erscheinen automatisch.
              {status.state === 'backoff' && ' Lichess-Limit: kurze Pause.'}
            </>
          ) : (
            <>
              <Icon name="clock" /> {graph.pending.length} Gegnerstellungen ohne Datenbank-Daten. Ohne Lichess-Token zählen dort nur deine eigenen Markierungen (z. B. aus dem PGN-Import).{' '}
              <button className="link-btn" onClick={() => setView('settings')}>Token eintragen</button>
            </>
          )}
        </div>
      )}
      {graph.needsEngine.length > 0 && (
        <div className="notice">
          <Icon name="search" /> {graph.needsEngine.length} tiefe Stellungen haben zu wenige Partien – dort gilt nur die Engine-Regel.{' '}
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
              <span>
                {g.family} <small>{g.gaps.length}</small>
              </span>
              <button
                className="btn small ghost"
                title={`Lückentour nur für ${g.family}`}
                onClick={() => {
                  setView('build');
                  setTimeout(() => startGuide(g.family), 0);
                }}
              >
                Tour
              </button>
            </h2>
            <ul>
              {(expanded.has(g.family) ? g.gaps : g.gaps.slice(0, PREVIEW)).map((gp) => (
                <li key={gp.id} className="gaprow">
                  <button className="gap-go" onClick={() => jump(gp.id)}>
                    <span className="line">{formatLine(gp.sans, notation)}</span>
                    <span className="meta">
                      {gp.viaTrap && settings.ui.showTraps && <span className="trap" title="Gegnerzug ist eine Chance (Fehler)"><Icon name="bolt" /></span>}
                      {gp.name && gp.name !== g.family && <span className="nm">{gp.name}</span>}
                      {settings.ui.showReach && gp.reach > 0 && <span className="reach">≈ {(gp.reach * 100).toFixed(1).replace(".", ",")} %</span>}
                    </span>
                  </button>
                  <GapMenu id={gp.id} />
                </li>
              ))}
            </ul>
            {g.gaps.length > PREVIEW && (
              <button
                className="link-btn more-gaps"
                onClick={() => {
                  const next = new Set(expanded);
                  if (next.has(g.family)) next.delete(g.family);
                  else next.add(g.family);
                  setExpanded(next);
                }}
              >
                {expanded.has(g.family) ? 'weniger anzeigen' : `alle ${g.gaps.length} anzeigen`}
              </button>
            )}
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

const PREVIEW = 8; // je Familie zuerst nur die wichtigsten Lücken

/** ⋯-Menü je Lücke: direkt hier erledigen, ohne erst ins Bauen zu springen (mit Rückgängig). */
function GapMenu({ id }: { id: number }) {
  const graph = useApp((s) => s.graph);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Tippen/Klicken daneben schließt das Menü (am Handy gibt es kein „Maus verlässt“)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  if (!graph) return null;
  const n = graph.nodes[id];
  const parent = n.parent >= 0 ? graph.nodes[n.parent] : undefined;
  return (
    <span className="rowmenu" ref={ref}>
      <button className="dots" aria-label="Aktionen für diese Lücke" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <span className="rowmenu-pop">
          {parent && n.uci && (
            <button
              onClick={() => {
                setOpen(false);
                void toggleOpp(parent.posKey, n.uci!, 'ignore', true).then(() =>
                  toast('Gegnerzug ignoriert', 'ok', { label: 'Rückgängig', run: () => void toggleOpp(parent.posKey, n.uci!, 'ignore', false) }),
                );
              }}
            >
              Gegnerzug ignorieren (nicht relevant)
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              void setEndOfLine(n.posKey, true).then(() =>
                toast('Ende der Linie gesetzt', 'ok', { label: 'Rückgängig', run: () => void setEndOfLine(n.posKey, false) }),
              );
            }}
          >
            Ende der Linie hier (hier improvisiere ich)
          </button>
        </span>
      )}
    </span>
  );
}
