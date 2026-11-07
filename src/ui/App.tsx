import { Builder } from './Builder';
import { Gaps } from './Gaps';
import { Home } from './Home';
import { SettingsView } from './SettingsView';
import { Trainer } from './Trainer';
import { selectRepertoire, setView, useApp, type View } from './store';

const NAV: { v: View; label: string; icon: string }[] = [
  { v: 'home', label: 'Start', icon: '⌂' },
  { v: 'build', label: 'Bauen', icon: '♞' },
  { v: 'gaps', label: 'Lücken', icon: '●' },
  { v: 'train', label: 'Training', icon: '⟳' },
  { v: 'settings', label: 'Einstellungen', icon: '⚙' },
];

export function App() {
  const loaded = useApp((s) => s.loaded);
  const view = useApp((s) => s.view);
  const repertoires = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  const gaps = useApp((s) => s.graph?.gaps.length);
  const graphBusy = useApp((s) => s.graphBusy);
  const ex = useApp((s) => s.explorerStatus);
  const toast = useApp((s) => s.toast);

  if (!loaded) return <div className="splash">RepLab lädt …</div>;

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
          <button className="gap-chip" onClick={() => setView('gaps')} title="Lücken im Repertoire">
            Lücken: <b data-testid="gap-count">{gaps ?? '…'}</b>
            {graphBusy && <span className="spin" aria-hidden>◌</span>}
          </button>
        )}
        <span className={`ex-dot ${ex.state}`} title={explorerTitle(ex.state, ex.lastError)} aria-label={explorerTitle(ex.state, ex.lastError)} />
        <nav className="nav-top" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => setView(n.v)}>
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
        {view === 'settings' && <SettingsView />}
      </main>
      <nav className="nav-bottom" aria-label="Hauptnavigation">
        {NAV.map((n) => (
          <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => setView(n.v)}>
            <span className="ic" aria-hidden>{n.icon}</span>
            <span>{n.label === 'Einstellungen' ? 'Mehr' : n.label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
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
