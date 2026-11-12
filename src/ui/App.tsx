import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Builder } from './Builder';
import { Gaps } from './Gaps';
import { Home } from './Home';
import { SettingsView } from './SettingsView';
import { Trainer } from './Trainer';
import { Studies } from './Studies';
import { Games } from './GamesView';
import { dismissToast, selectRepertoire, setView, toast as showToast, useApp, type View } from './store';
import { syncNow, syncTitle } from './sync';
import { Icon, type IconName } from './Icon';
import { Modal } from './Modal';
import { resetPages, swipeFlag, useSwipeNav } from './swipeNav';
import { InertContext } from './inert';
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
const TITLE: Record<View, string> = { home: 'Start', build: 'Repertoire', gaps: 'Lücken', train: 'Training', studies: 'Studien', settings: 'Einstellungen', games: 'Partien' };
const ORDER: View[] = [...NAV.map((n) => n.v), 'settings', 'games'];

const PHONE = '(max-width: 899px)';
function usePhone() {
  const [m, setM] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const q = matchMedia(PHONE);
    const on = () => setM(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return m;
}
const navIdx = (v: View) => NAV.findIndex((n) => n.v === v);

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
  const pagesRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const idx = navIdx(view);
  // Vorgeladene Nachbarseiten (nur Handy): bleiben gemountet, damit Wischen und Wechseln nichts neu aufbauen müssen
  const [warm, setWarm] = useState<View[]>([]);
  const [tracked, setTracked] = useState(view);
  if (tracked !== view) {
    // Die verlassene Seite bleibt als Nachbar stehen (statt ab- und gleich wieder aufgebaut zu werden); Nicht-Nachbarn fallen weg
    setTracked(view);
    setWarm((w) => [...new Set([...w, tracked])].filter((v) => idx >= 0 && navIdx(v) >= 0 && Math.abs(navIdx(v) - idx) === 1));
  }
  const shown = useMemo(() => ORDER.filter((v) => v === view || (phone && warm.includes(v))), [view, phone, warm]);
  const shownRef = useRef<View[]>([]);
  const rep = repertoires.find((r) => r.id === repId);

  // Kopfleiste: Trennlinie und kleiner Seitentitel erst beim Scrollen (große Überschrift ist dann weg)
  useEffect(() => {
    // Am Handy scrollt nur die aktive Seite (eigener Scroller je Seite), am Laptop das Fenster
    const pages = pagesRef.current;
    const on = () => {
      const m = pages?.querySelector<HTMLElement>(':scope > .page.active');
      setScrolled(window.scrollY > 24 || (m?.scrollTop ?? 0) > 24);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    pages?.addEventListener('scroll', on, { passive: true, capture: true }); // Scroll-Ereignisse bubbeln nicht
    return () => {
      window.removeEventListener('scroll', on);
      pages?.removeEventListener('scroll', on, { capture: true });
    };
  }, [loaded, view]);

  // Seitenwechsel. Ist die Seite schon vorgeladen (Wischen oder Nachbar-Tipp), tauschen nur die Rollen: nichts wird neu aufgebaut.
  // Eine frisch gemountete Seite gleitet aus der Richtung herein, in die gewechselt wurde.
  const lastView = useRef(view);
  useLayoutEffect(() => {
    const pages = pagesRef.current;
    const main = pages?.querySelector<HTMLElement>(':scope > .page.active');
    const left = lastView.current;
    const from = ORDER.indexOf(left);
    const to = ORDER.indexOf(view);
    lastView.current = view;
    if (!pages || !main || from === to) return;
    // Verschiebungen/Sichtbarkeit der Wisch-Geste zurücksetzen (im selben Bild, vor dem Zeichnen); verlassene Seite beginnt wieder oben
    resetPages(pages);
    const old = pages.querySelector<HTMLElement>(`:scope > [data-view="${left}"]`);
    if (old) old.scrollTop = 0;
    const wasWarm = shownRef.current.includes(view);
    if (swipeFlag.committed || wasWarm) {
      swipeFlag.committed = false;
      // chessground/Sheet neu messen – erst im nächsten Frame: Im selben Commit abgebaute Bretter sind sonst schon aus dem DOM,
      // aber noch nicht aufgeräumt und würden mit Größe 0 neu zeichnen (NaN-Pfeile)
      const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      return () => cancelAnimationFrame(raf);
    }
    main.dataset.enter = to > from ? 'next' : 'prev';
    const t = setTimeout(() => {
      delete main.dataset.enter;
      // chessground merkt sich die Brettposition – nach dem Hereingleiten neu messen lassen
      window.dispatchEvent(new Event('resize'));
    }, 320);
    return () => clearTimeout(t);
  }, [view]);
  useLayoutEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  // Nachbarseiten nach dem Wechsel in Ruhe nachladen (erst die nächste, dann die vorige) – unterbrechbar, damit Eingaben vorgehen
  useEffect(() => {
    if (!loaded || !phone || idx < 0) {
      setWarm((w) => (w.length ? [] : w));
      return;
    }
    const wanted = [NAV[idx + 1]?.v, NAV[idx - 1]?.v].filter(Boolean) as View[];
    let dead = false;
    const timers = wanted.map((v, i) =>
      window.setTimeout(() => {
        const run = () => !dead && startTransition(() => setWarm((w) => (w.includes(v) ? w : [...w, v])));
        if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1500 });
        else run();
      }, 450 + i * 600),
    );
    return () => {
      dead = true;
      timers.forEach(clearTimeout);
    };
  }, [view, phone, loaded, idx]);

  const neighbor = useCallback(
    (side: 1 | -1) => {
      const v = NAV[idx + side]?.v;
      return v ? pagesRef.current?.querySelector<HTMLElement>(`:scope > [data-view="${v}"]`) ?? null : null;
    },
    [idx],
  );
  const want = useCallback(
    (side: 1 | -1) => {
      const v = NAV[idx + side]?.v;
      if (v) setWarm((w) => (w.includes(v) ? w : [...w, v]));
    },
    [idx],
  );
  const prev = useCallback(() => idx > 0 && navTo(NAV[idx - 1].v), [idx]);
  const next = useCallback(() => idx >= 0 && idx < NAV.length - 1 && navTo(NAV[idx + 1].v), [idx]);
  useSwipeNav(appRef, { prev: idx > 0 ? prev : undefined, next: idx >= 0 && idx < NAV.length - 1 ? next : undefined, enabled: loaded && idx >= 0, pages: pagesRef, neighbor, want });

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
      <div className="pages" ref={pagesRef}>
        {shown.map((v) => (
          <Page key={v} v={v} active={v === view} repId={repId} />
        ))}
      </div>
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

/** Eine Seite in der Spur. Nachbarseiten sind „inert“: gemountet und gezeichnet, aber ohne Engine, Netz, Tastatur und Fokus. */
const Page = memo(function Page({ v, active, repId }: { v: View; active: boolean; repId?: string }) {
  return (
    <main className={`page${active ? ' active' : ''}`} data-view={v} aria-hidden={active ? undefined : true} {...(active ? {} : ({ inert: '' } as object))}>
      <InertContext.Provider value={!active}>{pageFor(v, repId)}</InertContext.Provider>
    </main>
  );
});

/** Seiteninhalt je Ansicht. */
function pageFor(view: View, repId?: string): ReactNode {
  switch (view) {
    case 'home':
      return <Home />;
    case 'build':
      return <Builder />;
    case 'gaps':
      return <Gaps />;
    // key: Repertoirewechsel setzt die Trainingsseite sauber neu auf (Sitzung, Fokus)
    case 'train':
      return <Trainer key={repId} />;
    case 'studies':
      return <Studies />;
    case 'settings':
      return <SettingsView />;
    case 'games':
      return <Games />;
  }
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
