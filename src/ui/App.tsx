import { useMemo } from 'react';
import { Builder } from './Builder';
import { Gaps } from './Gaps';
import { Home } from './Home';
import { SettingsView } from './SettingsView';
import { Trainer } from './Trainer';
import { Studies } from './Studies';
import { dismissToast, selectRepertoire, setView, useApp, type View } from './store';
import { syncNow, syncTitle } from './sync';
import { Icon, type IconName } from './Icon';
import { gapCounts } from '../core/graph';
import { pct } from './format';

const NAV: { v: View; label: string; icon: IconName }[] = [
  { v: 'home', label: 'Start', icon: 'home' },
  { v: 'build', label: 'Bauen', icon: 'tree' },
  { v: 'gaps', label: 'Lücken', icon: 'gap' },
  { v: 'train', label: 'Training', icon: 'train' },
  { v: 'studies', label: 'Studien', icon: 'book' },
  { v: 'settings', label: 'Einstellungen', icon: 'more' },
];

export function App() {
  const loaded = useApp((s) => s.loaded);
  const view = useApp((s) => s.view);
  const repertoires = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  const gapMin = useApp((s) => s.settings.ui.gapMinReach);
  // Nicht im Store-Selektor berechnen: ein neues Objekt pro Aufruf lässt React endlos neu rendern
  const graph = useApp((s) => s.graph);
  const gaps = useMemo(() => (graph ? gapCounts(graph, gapMin) : undefined), [graph, gapMin]);
  const graphBusy = useApp((s) => s.graphBusy);
  const ex = useApp((s) => s.explorerStatus);
  const toast = useApp((s) => s.toast);
  const sync = useApp((s) => s.sync);

  if (!loaded)
    return (
      <div className="splash" role="status" aria-label="RepLab lädt">
        <div>Rep<span>Lab</span></div>
        <i aria-hidden />
      </div>
    );

  return (
    <div className={`app view-${view}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="Start">
          Rep<span>Lab</span>
        </button>
        {repertoires.length > 0 && (
          <select className="rep-select" value={repId} onChange={(e) => void selectRepertoire(e.target.value)} aria-label="Repertoire wählen">
            {repertoires.map((r) => (
              <option key={r.id} value={r.id}>
                {r.color === 'white' ? '○' : '●'} {r.name}
              </option>
            ))}
          </select>
        )}
        {repertoires.length > 0 && (
          <button
            className="gap-chip"
            onClick={() => setView('gaps')}
            title={gaps ? `${gaps.important} wichtige Lücken (≥ ${pct(gapMin)}) · ${gaps.total} insgesamt` : 'Lücken im Repertoire'}
          >
            <span className="lbl">Lücken: </span>
            <b data-testid="gap-count">{gaps?.important ?? '…'}</b>
            {graphBusy && <span className="spin" aria-hidden>◌</span>}
          </button>
        )}
        {sync.connected && (
          <button
            className={`sync-btn ${sync.status} ${sync.dirty ? 'dirty' : ''}`}
            data-testid="sync-btn"
            title={syncTitle(sync)}
            aria-label={syncTitle(sync)}
            onClick={() => void syncNow(true)}
          >
            <Icon name="cloud" />
            {sync.status === 'syncing' ? <i className="spin">◌</i> : sync.status === 'needs-auth' || sync.dirty ? <i>!</i> : sync.status === 'error' ? <i>×</i> : <i>✓</i>}
          </button>
        )}
        <span className={`ex-dot ${ex.state}`} title={explorerTitle(ex.state, ex.lastError)} aria-label={explorerTitle(ex.state, ex.lastError)} />
        <nav className="nav-top" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => navTo(n.v)}>
              <Icon name={n.icon} />
              {n.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {view === 'home' && <Home />}
        {view === 'build' && <Builder />}
        {view === 'gaps' && <Gaps />}
        {view === 'train' && <Trainer />}
        {view === 'studies' && <Studies />}
        {view === 'settings' && <SettingsView />}
      </main>
      <nav className="nav-bottom" aria-label="Hauptnavigation">
        {NAV.map((n) => (
          <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => navTo(n.v)}>
            <span className="ic"><Icon name={n.icon} /></span>
            <span>{n.label === 'Einstellungen' ? 'Mehr' : n.label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind} ${toast.action ? 'has-action' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                const run = toast.action!.run;
                dismissToast();
                run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Navigation; erneuter Tipp auf „Studien“ führt aus einer offenen Studie zurück zur Liste. */
function navTo(v: View) {
  if (v === 'studies' && useApp.getState().view === 'studies') useApp.setState({ studyId: undefined });
  setView(v);
}

function explorerTitle(state: string, err?: string) {
  switch (state) {
    case 'busy':
      return 'Lichess-Datenbank: lädt';
    case 'backoff':
      return 'Lichess-Datenbank: Limit, Pause';
    case 'auth':
      return 'Lichess-Datenbank: Token fehlt/ungültig';
    case 'error':
      return `Lichess-Datenbank: Fehler ${err ?? ''}`;
    default:
      return 'Lichess-Datenbank: bereit';
  }
}
