import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Builder } from './Builder';
import { Gaps } from './Gaps';
import { Home } from './Home';
import { SettingsView } from './SettingsView';
import { Trainer } from './Trainer';
import { Studies } from './Studies';
import { dismissToast, selectRepertoire, setView, toast as showToast, useApp, type View } from './store';
import { syncNow, syncTitle } from './sync';
import { Icon, type IconName } from './Icon';
import { Modal } from './Modal';
import { useSwipeNav } from './swipeNav';
import { refreshToday } from './today';
import { gapCounts } from '../core/graph';
import { isDue, isNew } from '../core/srs';
import { pct } from './format';

// Fünf Hauptseiten (Wisch-Reihenfolge). Einstellungen liegen hinter dem Zahnrad oben rechts.
const NAV: { v: View; label: string; icon: IconName }[] = [
  { v: 'home', label: 'Start', icon: 'home' },
  { v: 'build', label: 'Repertoire', icon: 'tree' },
  { v: 'gaps', label: 'Lücken', icon: 'gap' },
  { v: 'train', label: 'Training', icon: 'train' },
  { v: 'studies', label: 'Studien', icon: 'book' },
];
const TITLE: Record<View, string> = { home: 'Start', build: 'Repertoire', gaps: 'Lücken', train: 'Training', studies: 'Studien', settings: 'Einstellungen' };
const ORDER: View[] = [...NAV.map((n) => n.v), 'settings'];

export function App() {
  const loaded = useApp((s) => s.loaded);
  const view = useApp((s) => s.view);
  const repertoires = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  const gapMin = useApp((s) => s.settings.ui.gapMinReach);
  // Nicht im Store-Selektor berechnen: ein neues Objekt pro Aufruf lässt React endlos neu rendern
  const graph = useApp((s) => s.graph);
  const gaps = useMemo(() => (graph ? gapCounts(graph, gapMin) : undefined), [graph, gapMin]);
  const cards = useApp((s) => s.cards);
  // Fällige Wiederholungen als Zahl am Training-Reiter (ohne Tageslimit – nur als Hinweis)
  const due = useMemo(() => {
    const now = Date.now();
    let n = 0;
    for (const c of cards.values()) if (!c.suspended && !isNew(c.srs) && isDue(c.srs, now)) n++;
    return n;
  }, [cards]);
  // Zähler an den Reitern gelten für ALLE Repertoires bzw. Studien (sonst sieht man Fälliges nur im aktiven Repertoire)
  const today = useApp((s) => s.today);
  const studyId = useApp((s) => s.studyId);
  const dueAll = useMemo(() => (today ? Object.values(today.reps).reduce((n, r) => n + r.due, 0) : due), [today, due]);
  const studyDueAll = useMemo(() => (today ? today.studies.reduce((n, s) => n + s.due, 0) : 0), [today]);
  useEffect(() => {
    if (!loaded) return;
    // Studien nur dort neu zählen, wo man die Zahl sieht (braucht ggf. den Studienbaum) – nicht bei jeder Trainingsantwort
    void refreshToday(view === 'home' || (view === 'studies' && !studyId));
  }, [loaded, cards, view, studyId, repertoires]);
  const graphBusy = useApp((s) => s.graphBusy);
  const ex = useApp((s) => s.explorerStatus);
  const toast = useApp((s) => s.toast);
  const sync = useApp((s) => s.sync);
  const [picker, setPicker] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const rep = repertoires.find((r) => r.id === repId);

  // Kopfleiste: Trennlinie und kleiner Seitentitel erst beim Scrollen (große Überschrift ist dann weg)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // Seitenwechsel: neue Seite gleitet aus der Richtung herein, in die gewechselt wurde
  const lastView = useRef(view);
  useLayoutEffect(() => {
    const main = mainRef.current;
    const from = ORDER.indexOf(lastView.current);
    const to = ORDER.indexOf(view);
    lastView.current = view;
    if (!main || from === to) return;
    main.dataset.enter = to > from ? 'next' : 'prev';
    const t = setTimeout(() => {
      delete main.dataset.enter;
      // chessground merkt sich die Brettposition – nach dem Hereingleiten neu messen lassen
      window.dispatchEvent(new Event('resize'));
    }, 320);
    return () => clearTimeout(t);
  }, [view]);

  const idx = NAV.findIndex((n) => n.v === view);
  const prev = useCallback(() => idx > 0 && navTo(NAV[idx - 1].v), [idx]);
  const next = useCallback(() => idx >= 0 && idx < NAV.length - 1 && navTo(NAV[idx + 1].v), [idx]);
  useSwipeNav(appRef, mainRef, { prev: idx > 0 ? prev : undefined, next: idx >= 0 && idx < NAV.length - 1 ? next : undefined, enabled: loaded && idx >= 0 });

  if (!loaded)
    return (
      <div className="splash" role="status" aria-label="RepLab lädt">
        <div>Rep<span>Lab</span></div>
        <i aria-hidden />
      </div>
    );

  const exProblem = ex.state === 'backoff' || ex.state === 'auth' || ex.state === 'error';
  const badge = (v: View) =>
    v === 'gaps' && gaps && gaps.important > 0 ? (
      <b className="nav-badge gap">{gaps.important > 99 ? '99+' : gaps.important}</b>
    ) : v === 'train' && dueAll > 0 ? (
      <b className="nav-badge">{dueAll > 99 ? '99+' : dueAll}</b>
    ) : v === 'studies' && studyDueAll > 0 ? (
      <b className="nav-badge">{studyDueAll > 99 ? '99+' : studyDueAll}</b>
    ) : null;

  return (
    <div className={`app view-${view}`} ref={appRef}>
      <header className={`topbar ${scrolled ? 'scrolled' : ''} ${view !== 'home' && (scrolled || view === 'build') ? 'show-title' : ''}`}>
        <button className="brand" onClick={() => navTo('home')} aria-label="Start">
          <span className="brand-word">
            Rep<span>Lab</span>
          </span>
          <span className="brand-title" aria-hidden>
            {TITLE[view]}
          </span>
        </button>
        <nav className="nav-top" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => navTo(n.v)}>
              <Icon name={n.icon} />
              {n.label}
              {n.v === 'gaps' && repertoires.length > 0 && (
                <b
                  className={`nav-count ${gaps?.important ? 'gap' : ''}`}
                  data-testid="gap-count"
                  title={gaps ? `${gaps.important} wichtige Lücken (≥ ${pct(gapMin)}) · ${gaps.total} insgesamt` : 'Lücken im Repertoire'}
                >
                  {gaps?.important ?? '…'}
                </b>
              )}
              {n.v === 'gaps' && graphBusy && <Icon name="loader" className="spin" />}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          {exProblem && (
            <button
              className={`status-chip ${ex.state}`}
              title={explorerTitle(ex.state, ex.lastError)}
              aria-label={explorerTitle(ex.state, ex.lastError)}
              onClick={() => showToast(explorerTitle(ex.state, ex.lastError), 'err')}
            >
              <Icon name={ex.state === 'backoff' ? 'clock' : 'info'} />
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
              {sync.status === 'syncing' ? <Icon name="loader" className="spin" /> : sync.status === 'needs-auth' || sync.dirty || sync.status === 'error' ? <i aria-hidden /> : null}
            </button>
          )}
          {rep && (
            <button className="rep-select" onClick={() => setPicker(true)} aria-label={`Repertoire: ${rep.name} – wechseln`} aria-haspopup="dialog">
              <span className={`kdot ${rep.color}`} aria-hidden />
              <span className="rep-name-t">{rep.name}</span>
              <Icon name="down" />
            </button>
          )}
          <button className="icon-btn" aria-label="Einstellungen" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => navTo('settings')}>
            <Icon name="gear" />
          </button>
        </div>
      </header>
      <main ref={mainRef}>
        {view === 'home' && <Home />}
        {view === 'build' && <Builder />}
        {view === 'gaps' && <Gaps />}
        {/* key: Repertoirewechsel setzt die Trainingsseite sauber neu auf (Sitzung, Fokus) */}
        {view === 'train' && <Trainer key={repId} />}
        {view === 'studies' && <Studies />}
        {view === 'settings' && <SettingsView />}
      </main>
      <nav className="nav-bottom" aria-label="Hauptnavigation">
        {NAV.map((n) => (
          <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => navTo(n.v)}>
            <span className="ic">
              <Icon name={n.icon} />
              {badge(n.v)}
            </span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {picker && (
        <Modal
          title="Repertoire wählen"
          onClose={() => setPicker(false)}
          actions={[
            {
              label: 'Repertoires verwalten',
              onClick: () => {
                setPicker(false);
                navTo('settings');
              },
            },
            { label: 'Schließen', kind: 'ghost', onClick: () => setPicker(false) },
          ]}
        >
          <ul className="picker">
            {repertoires.map((r) => (
              <li key={r.id}>
                <button
                  className="picker-row"
                  aria-current={r.id === repId ? 'true' : undefined}
                  onClick={() => {
                    setPicker(false);
                    if (r.id !== repId) void selectRepertoire(r.id);
                  }}
                >
                  <span className={`kdot ${r.color}`} aria-hidden />
                  <span className="picker-name">
                    <b>{r.name}</b>
                    <small>
                      {r.color === 'white' ? 'Weiß' : 'Schwarz'}
                      {r.isMain ? ' · Hauptrepertoire' : ''}
                    </small>
                  </span>
                  {r.id === repId && <Icon name="check" />}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
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
      return 'Lichess-Datenbank: Limit erreicht, kurze Pause – geht gleich weiter';
    case 'auth':
      return 'Lichess-Datenbank: Token fehlt oder ist ungültig (Einstellungen)';
    case 'error':
      return `Lichess-Datenbank: Fehler ${err ?? ''}`;
    default:
      return 'Lichess-Datenbank: bereit';
  }
}
