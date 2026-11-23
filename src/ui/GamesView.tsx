// Partien: meine geladenen Partien (Lichess/Chess.com) gegen das Repertoire prüfen.
// Aufbau nach „Was soll ich tun?“: oben „Zu prüfen“ – Partien, in denen du nach der Abweichung (deiner oder der des Gegners)
// schlechter standest, mit Mini-Brett und einer klaren Aktion. Darunter die Partienliste (Filter, Auswahl) und als zweiter
// Reiter die Auswertung (Anteile, Brennpunkte, Training aus den Abweichungen).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { displaySan, formatLine, moveNumberPrefix } from '../core/chess';
import { hotspots, openingOf, plyMarks, summarize, type GameReview, type Hotspot, type ReviewStatus } from '../core/gameReview';
import { SPEED_NAME, type Speed } from '../core/opponentStats';
import { familyDe, nameDe } from '../core/openings';
import type { SessionItem } from '../core/session';
import { lichessToken, lineFromUcis, selectRepertoire, setLine, setView, toast, useApp } from './store';
import { loadMyGames, SOURCE_NAME, useMyGames, type GameSource } from './games';
import { useEco, useReviewedGames, type Row } from './gameRows';
import { useAssessments } from './gameEvals';
import { GameCard, VerdictBadge } from './GameCard';
import { GameDetail } from './GameDetail';
import { Icon } from './Icon';
import { useInert } from './inert';

type Filter = 'all' | 'flag' | 'dev' | 'opp' | 'hole' | 'mistake';
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'Alle' },
  { k: 'flag', label: 'Zu prüfen' },
  { k: 'dev', label: 'Meine Abweichungen' },
  { k: 'opp', label: 'Unvorbereitet' },
  { k: 'hole', label: 'Lücken' },
  { k: 'mistake', label: 'Fehler' },
];
const PERIODS: { d: number; label: string }[] = [
  { d: 0, label: 'Gesamter Zeitraum' },
  { d: 7, label: 'Letzte 7 Tage' },
  { d: 30, label: 'Letzte 30 Tage' },
  { d: 90, label: 'Letzte 3 Monate' },
  { d: 365, label: 'Letztes Jahr' },
];

export const STATUS_TEXT: Record<ReviewStatus, string> = {
  'in-rep': 'Ganz im Repertoire',
  'my-deviation': 'Du bist abgewichen',
  'opp-new': 'Gegner unvorbereitet',
  hole: 'Lücke: noch kein Zug',
  end: 'Ende-Marker erreicht',
};

/** Reihenfolge und Beschriftung der Auswertung (Balken + Legende) */
const EVAL_ROWS: { s: ReviewStatus; label: string; cls: string; filter?: Filter }[] = [
  { s: 'in-rep', label: 'im Repertoire', cls: 'ok' },
  { s: 'end', label: 'bis zum Ende-Marker', cls: 'end' },
  { s: 'opp-new', label: 'Gegner unvorbereitet', cls: 'opp', filter: 'opp' },
  { s: 'my-deviation', label: 'eigene Abweichung', cls: 'dev', filter: 'dev' },
  { s: 'hole', label: 'Lücke', cls: 'hole', filter: 'hole' },
];

const fmt1 = (n: number) => n.toFixed(1).replace('.', ',').replace(',0', '');

/** Zugfolge (SAN) bis vor den Ereignis-Halbzug */
export function prefixSans(prefix: string[]): string[] {
  try {
    return lineFromUcis(prefix)
      .slice(1)
      .map((s) => s.san!);
  } catch {
    return [];
  }
}

/** Stelle im Repertoire öffnen: Weg der Partie bis zum Ereignis (bei Abweichung/Unvorbereitetem/Lücke inkl. gespieltem Zug) */
export function openInRepertoire(prefix: string[], played?: string) {
  try {
    setLine(lineFromUcis(played ? [...prefix, played] : prefix));
    setView('build');
  } catch {
    toast('Diese Stelle lässt sich nicht öffnen.', 'err');
  }
}

/** Trainingssitzung mit genau diesen Stellungen starten (echte Wiederholung: falsch = vergessen) */
export function startDrill(items: SessionItem[]) {
  if (!items.length) return toast('Für diese Stellungen gibt es noch keine Lernkarten.', 'info');
  useApp.setState({ trainDrill: items });
  setView('train');
}

/** Partie von außen öffnen (Startseite „Letzte Partien“) */
export function openGameFromHome(key: string) {
  useApp.setState({ gameOpen: key });
  setView('games');
}

export function Games() {
  const stored = useMyGames();
  const { rows, color, loaded } = useReviewedGames();
  const reps = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  const cards = useApp((s) => s.cards);
  const settings = useApp((s) => s.settings);
  const gameOpen = useApp((s) => s.gameOpen);
  const notation = settings.ui.notation;
  const rep = reps.find((r) => r.id === repId);
  const eco = useEco(loaded);

  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [status, setStatus] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState(0);
  const [speed, setSpeed] = useState('');
  const [fam, setFam] = useState('');
  const [result, setResult] = useState('');
  const [src, setSrc] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [onlySel, setOnlySel] = useState(false);
  const [openKey, setOpenKey] = useState<string>();
  const [limit, setLimit] = useState(40);
  const [loading, setLoading] = useState(false);
  const [allSpots, setAllSpots] = useState(false);
  const [allFlags, setAllFlags] = useState(false);

  // Brett-Ansicht beginnt oben; zurück in der Liste steht man wieder an derselben Stelle (Handy: eigener Scroller je Seite)
  const inert = useInert();
  const listScroll = useRef(0);
  const scroller = () => document.querySelector<HTMLElement>('.pages > main.active');
  const openGame = (key: string) => {
    listScroll.current = Math.max(scroller()?.scrollTop ?? 0, window.scrollY);
    setOpenKey(key);
  };
  const lastOpen = useRef(openKey);
  useLayoutEffect(() => {
    if (inert || lastOpen.current === openKey) return;
    const to = openKey ? 0 : listScroll.current;
    lastOpen.current = openKey;
    const s = scroller();
    if (s) s.scrollTop = to;
    window.scrollTo(0, to);
  }, [openKey, inert]);

  // Bewertung nach der Abweichung (Lichess-Analyse oder Stockfish im Hintergrund – nicht während der Brett-Ansicht)
  const { of: assessOf, pending } = useAssessments(rows, color, !inert && !openKey);

  const opening = useMemo(() => (eco ? new Map(rows.map((r) => [r.key, openingOf(r.game.m.split(' '), eco)])) : undefined), [rows, eco]);
  const famOf = (r: Row) => {
    const n = opening?.get(r.key);
    return n ? familyDe(n) : undefined;
  };
  const families = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const f = famOf(r);
      if (f) m.set(f, (m.get(f) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const speeds = useMemo(() => [...new Set(rows.map((r) => r.game.sp).filter(Boolean))] as Speed[], [rows]);
  const sources = useMemo(() => [...new Set(rows.map((r) => r.game.src ?? 'lichess'))], [rows]);

  const resetFilters = () => {
    setQ('');
    setPeriod(0);
    setSpeed('');
    setFam('');
    setResult('');
    setSrc('');
    setLimit(40);
  };

  // Von der Startseite: genau diese Partie öffnen (Filter zurücksetzen, damit sie in der Liste ist)
  useEffect(() => {
    if (inert || !gameOpen) return;
    useApp.setState({ gameOpen: undefined });
    resetFilters();
    setStatus('all');
    setOnlySel(false);
    openGame(gameOpen);
  }, [gameOpen, inert]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter ohne Status: daraus Auswertung, Brennpunkte und „Zu prüfen“
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = period ? Date.now() - period * 86400_000 : 0;
    return rows.filter(
      (r) =>
        (!needle || (r.game.opp ?? '').toLowerCase().includes(needle)) &&
        (!since || (r.game.t ?? 0) >= since) &&
        (!speed || r.game.sp === speed) &&
        (!fam || famOf(r) === fam) &&
        (!result || String(r.game.r) === result) &&
        (!src || (r.game.src ?? 'lichess') === src),
    );
  }, [rows, q, period, speed, fam, result, src, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const flagged = base.filter((r) => assessOf(r.key)?.verdict === 'flag');
  const selected = useMemo(() => base.filter((r) => sel.has(r.key)), [base, sel]);
  const scope = selected.length ? selected : base;
  const sum = useMemo(() => summarize(scope), [scope]);
  const spots = useMemo(() => hotspots(scope, 6), [scope]);
  const listBase = onlySel && selected.length ? selected : base;
  const list = listBase.filter((r) =>
    status === 'all'
      ? true
      : status === 'flag'
        ? assessOf(r.key)?.verdict === 'flag'
        : status === 'dev'
          ? r.rev.status === 'my-deviation'
          : status === 'opp'
            ? r.rev.status === 'opp-new'
            : status === 'hole'
              ? r.rev.status === 'hole'
              : !!r.rev.mistake,
  );
  // Brett-Ansicht blättert durch die Liste; kam die Partie von „Zu prüfen“ und ist sie nicht in der Liste, durch „Zu prüfen“
  const browse = openKey && !list.some((r) => r.key === openKey) && flagged.some((r) => r.key === openKey) ? flagged : list;
  const anyFilter = !!(q || period || speed || fam || result || src);

  // Training: Stellungen, in denen ich abgewichen bin und eine Lernkarte habe (je Stellung einmal, häufigste zuerst)
  const drillOf = (rs: Row[]) => {
    const m = new Map<string, SessionItem>();
    for (const r of rs) {
      if (r.rev.status !== 'my-deviation' || !r.rev.keyAt) continue;
      const card = cards.get(r.rev.keyAt);
      if (!card || card.suspended) continue;
      const cur = m.get(r.rev.keyAt);
      if (cur) cur.priority++;
      else m.set(r.rev.keyAt, { cardId: card.id, posKey: card.posKey, path: r.rev.prefix, priority: 1 });
    }
    return [...m.values()].sort((a, b) => b.priority - a.priority);
  };
  const drill = useMemo(() => drillOf(scope), [scope, cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const unprepared = useMemo(() => new Set(scope.filter((r) => r.rev.status === 'opp-new' || r.rev.status === 'hole').map((r) => `${r.rev.keyAt}|${r.rev.played?.uci}`)).size, [scope]);

  const sanLabel = (ply: number, san: string) => moveNumberPrefix(ply) + displaySan(san, notation);

  /** Partien mit den hinterlegten Namen neu laden (Lichess und/oder Chess.com) */
  const reload = async () => {
    const names: [GameSource, string | undefined][] = [
      ['lichess', stored?.sources.lichess?.user || settings.ui.lichessUser],
      ['chesscom', stored?.sources.chesscom?.user || settings.ui.chesscomUser],
    ];
    if (!names.some(([, n]) => n)) return setView('settings');
    setLoading(true);
    try {
      let n = 0;
      for (const [s, name] of names) if (name) n += await loadMyGames(s, name, 300, s === 'lichess' ? lichessToken() : undefined);
      toast(`${n} Partien geladen`, 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setLoading(false);
    }
  };

  const toggleSel = (key: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  /** Brennpunkt → Liste auf genau diese Partien einschränken */
  const focusSpot = (h: Hotspot) => {
    setSel(new Set(h.idx.map((i) => scope[i].key)));
    setOnlySel(true);
    setStatus('all');
    setTab('list');
  };
  /** die eine passende Aktion zur Partie: trainieren (eigene Abweichung) bzw. Antwort/Zug festlegen */
  const fixAction = (r: Row) => {
    const rev = r.rev;
    const card = rev.status === 'my-deviation' && rev.keyAt ? cards.get(rev.keyAt) : undefined;
    if (card && !card.suspended)
      return (
        <button className="btn small primary" onClick={() => startDrill([{ cardId: card.id, posKey: card.posKey, path: rev.prefix, priority: 1 }])}>
          <Icon name="train" /> Stellung trainieren
        </button>
      );
    if (rev.status === 'opp-new')
      return (
        <button className="btn small primary" onClick={() => openInRepertoire(rev.prefix, rev.played!.uci)}>
          Antwort festlegen
        </button>
      );
    if (rev.status === 'hole')
      return (
        <button className="btn small primary" onClick={() => openInRepertoire(rev.prefix)}>
          Zug festlegen
        </button>
      );
    return (
      <button className="btn small" onClick={() => openInRepertoire(rev.prefix, rev.played?.uci)}>
        Im Repertoire öffnen
      </button>
    );
  };

  if (!loaded)
    return (
      <div className="page games-page">
        <header className="page-head">
          <h1>Partien</h1>
        </header>
        <div className="empty card empty-cta">
          <Icon name="clock" />
          <p>
            Noch keine Partien geladen. Trag in den Einstellungen deinen Lichess- oder Chess.com-Namen ein – dann siehst du hier, wo du oder deine Gegner von
            deiner Vorbereitung abweichen und wie du danach standest.
          </p>
          <div className="row-actions center">
            {settings.ui.lichessUser || settings.ui.chesscomUser ? (
              <button className="btn primary" disabled={loading} onClick={() => void reload()}>
                {loading ? 'Lade …' : 'Partien laden'}
              </button>
            ) : (
              <button className="btn primary" onClick={() => setView('settings')}>
                Zu den Einstellungen
              </button>
            )}
          </div>
        </div>
      </div>
    );

  const openIdx = openKey ? browse.findIndex((r) => r.key === openKey) : -1;
  if (openKey && openIdx >= 0)
    return (
      <GameDetail
        rows={browse}
        index={openIdx}
        color={color}
        opening={(k) => opening?.get(k)}
        assessment={(k) => assessOf(k)}
        onIndex={(i) => setOpenKey(browse[i].key)}
        onClose={() => setOpenKey(undefined)}
      />
    );

  const pct = (n: number) => (sum.games ? Math.round((100 * n) / sum.games) : 0);
  const shownFlags = allFlags ? flagged : flagged.slice(0, 4);

  return (
    <div className="page games-page" data-testid="games-page">
      <header className="page-head">
        <h1>
          Partien <span className="count">{rows.length}</span>
        </h1>
        <div className="tools">
          <button className="btn small" disabled={loading} onClick={() => void reload()}>
            {loading ? <Icon name="loader" className="spin" /> : <Icon name="download" />} {loading ? 'Lade …' : 'Aktualisieren'}
          </button>
          <button className="btn small ghost" onClick={() => setView('settings')}>
            Quellen
          </button>
        </div>
      </header>

      {reps.length > 1 && (
        <div className="seg small games-reps" role="group" aria-label="Prüfen gegen">
          {reps.map((r) => (
            <button key={r.id} aria-pressed={r.id === repId} onClick={() => r.id !== repId && void selectRepertoire(r.id)}>
              <span className={`kdot ${r.color}`} aria-hidden /> {r.name}
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        Deine {rows.length} Partien mit {color === 'white' ? 'Weiß' : 'Schwarz'} gegen „{rep?.name}“: Wo verlässt du oder dein Gegner die Vorbereitung – und
        wie stehst du danach?
      </p>

      {/* 1. Was jetzt? Partien, in denen du nach der Abweichung schlechter standest */}
      <section className="card to-review" data-testid="to-review">
        <header className="tr-head">
          <h2>
            Zu prüfen <small>{flagged.length}</small>
          </h2>
          {pending > 0 && (
            <span className="hint tr-progress">
              <Icon name="loader" className="spin" /> Stockfish bewertet noch {pending} {pending === 1 ? 'Partie' : 'Partien'}
            </span>
          )}
        </header>
        {flagged.length ? (
          <>
            <p className="hint">Hier standest du nach der Abweichung schlechter – deine eigene Abweichung oder ein Gegnerzug, auf den du nicht vorbereitet warst.</p>
            <ul className="game-cards">
              {shownFlags.map((r) => (
                <GameCard
                  key={r.key}
                  row={r}
                  a={assessOf(r.key)}
                  color={color}
                  notation={notation}
                  onOpen={() => openGame(r.key)}
                  actions={
                    <>
                      <button className="btn small ghost" onClick={() => openGame(r.key)}>
                        Ansehen
                      </button>
                      {fixAction(r)}
                    </>
                  }
                />
              ))}
            </ul>
            {flagged.length > 4 && (
              <button className="link-btn" onClick={() => setAllFlags((v) => !v)}>
                {allFlags ? 'weniger anzeigen' : `alle ${flagged.length} zeigen`}
              </button>
            )}
          </>
        ) : (
          <p className="hint">
            {pending > 0
              ? 'Die Bewertungen laufen noch – Partien, nach deren Abweichung du schlechter standest, erscheinen hier.'
              : 'Nichts Auffälliges: In keiner bewerteten Partie standest du nach der Abweichung schlechter.'}
          </p>
        )}
      </section>

      <section className="games-filters" aria-label="Partien auswählen">
        <label className="gf-search">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gegner suchen" aria-label="Gegner suchen" />
        </label>
        <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Zeitraum">
          {PERIODS.map((p) => (
            <option key={p.d} value={p.d}>
              {p.label}
            </option>
          ))}
        </select>
        {speeds.length > 0 && (
          <select value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Tempo">
            <option value="">Jedes Tempo</option>
            {speeds.map((s) => (
              <option key={s} value={s}>
                {SPEED_NAME[s]}
              </option>
            ))}
          </select>
        )}
        {families.length > 0 && (
          <select value={fam} onChange={(e) => setFam(e.target.value)} aria-label="Eröffnung">
            <option value="">Jede Eröffnung</option>
            {families.map(([f, n]) => (
              <option key={f} value={f}>
                {f} ({n})
              </option>
            ))}
          </select>
        )}
        <select value={result} onChange={(e) => setResult(e.target.value)} aria-label="Ergebnis">
          <option value="">Jedes Ergebnis</option>
          <option value="1">Siege</option>
          <option value="0">Remis</option>
          <option value="-1">Niederlagen</option>
        </select>
        {sources.length > 1 && (
          <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Quelle">
            <option value="">Lichess + Chess.com</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_NAME[s]}
              </option>
            ))}
          </select>
        )}
        {anyFilter && (
          <button className="link-btn" onClick={resetFilters}>
            Filter zurücksetzen
          </button>
        )}
      </section>

      {selected.length > 0 && (
        <div className="sel-bar" data-testid="sel-bar">
          <b>{selected.length} ausgewählt</b>
          <span className="hint">Auswertung gilt nur für die Auswahl</span>
          <label className="check">
            <input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> nur Auswahl zeigen
          </label>
          <button
            className="link-btn"
            onClick={() => {
              setSel(new Set());
              setOnlySel(false);
            }}
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      <div className="seg games-tabs" role="tablist" aria-label="Ansicht">
        <button role="tab" aria-selected={tab === 'list'} aria-pressed={tab === 'list'} onClick={() => setTab('list')}>
          Partien <small>{base.length}</small>
        </button>
        <button role="tab" aria-selected={tab === 'stats'} aria-pressed={tab === 'stats'} onClick={() => setTab('stats')}>
          Auswertung
        </button>
      </div>

      {tab === 'stats' && (
        <>
          <section className="card games-eval" data-testid="games-sum" aria-label="Auswertung">
            <header className="ge-head">
              <h2>
                {selected.length ? 'Auswahl' : anyFilter ? 'Gefilterte Partien' : 'Alle Partien'} <small>{sum.games}</small>
              </h2>
              {sum.total !== undefined && (
                <span className="ge-score" title="Punkte: Sieg 1, Remis ½">
                  {sum.total} % Punkte
                </span>
              )}
            </header>
            {sum.games > 0 ? (
              <>
                <div className="ge-bar" aria-hidden>
                  {EVAL_ROWS.map((e) => (sum.count[e.s] ? <i key={e.s} className={e.cls} style={{ flexGrow: sum.count[e.s] }} /> : null))}
                </div>
                <ul className="ge-rows">
                  {EVAL_ROWS.map((e) => {
                    const n = sum.count[e.s];
                    if (!n && (e.s === 'end' || e.s === 'hole')) return null;
                    const avg = e.s === 'my-deviation' ? sum.avgMove.dev : e.s === 'opp-new' ? sum.avgMove.opp : e.s === 'hole' ? sum.avgMove.hole : undefined;
                    const body = (
                      <>
                        <i className={`dot ${e.cls}`} aria-hidden />
                        <span className="ge-label">
                          <b>{n}</b> {e.label}
                        </span>
                        <span className="ge-meta">
                          {pct(n)} %{avg !== undefined && <> · Ø Zug {fmt1(avg)}</>}
                          {sum.score[e.s] !== undefined && <> · {sum.score[e.s]} % Punkte</>}
                        </span>
                      </>
                    );
                    return (
                      <li key={e.s}>
                        {e.filter && n ? (
                          <button
                            className="ge-row"
                            onClick={() => {
                              setStatus(e.filter!);
                              setTab('list');
                            }}
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="ge-row">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="ge-foot">
                  {sum.heldMove !== undefined && sum.heldMove > 0 && <>Im Mittel bleibt die Partie bis Zug {sum.heldMove} in deiner Vorbereitung.</>}
                  {sum.mistakes > 0 && <> {sum.mistakes} Fehler in der Eröffnung (Lichess-Analyse).</>}
                </p>
              </>
            ) : (
              <p className="hint">Keine Partien in dieser Auswahl.</p>
            )}
          </section>

          {spots.length > 0 && (
            <section className="card games-spots" data-testid="hotspots">
              <h2>Brennpunkte</h2>
              <p className="hint">Wo deine Partien am häufigsten die Vorbereitung verlassen.</p>
              <ul>
                {(allSpots ? spots : spots.slice(0, 3)).map((h) => {
                  const line = formatLine(prefixSans(h.prefix), notation) || 'Grundstellung';
                  return (
                    <li key={`${h.kind}|${h.keyAt}|${h.played.uci}`} className={`hs-row ${h.kind}`}>
                      <span className={`hs-kind ${h.kind}`}>{h.kind === 'dev' ? 'Du' : h.kind === 'opp' ? 'Gegner' : 'Lücke'}</span>
                      <span className="hs-text">
                        <span className="hs-line">nach {line}</span>
                        <span>
                          <b>{sanLabel(h.ply, h.played.san)}</b>
                          {h.kind === 'dev' && h.rep && <> statt <b className="me">{sanLabel(h.ply, h.rep.san)}</b></>}
                          {h.kind === 'opp' && <> – nicht vorbereitet</>}
                          {h.kind === 'hole' && <> – kein Zug festgelegt</>}
                        </span>
                        <small className="hint">
                          {h.n}× · {h.score} % Punkte
                        </small>
                      </span>
                      <span className="hs-acts">
                        <button className="btn small" onClick={() => focusSpot(h)}>
                          {h.n > 1 ? `${h.n} Partien` : 'Partie'}
                        </button>
                        {/* Lücke: der gespielte Zug war meiner – die Stellung davor öffnen, um einen Zug festzulegen */}
                        <button className="btn small ghost" onClick={() => openInRepertoire(h.prefix, h.kind === 'hole' ? undefined : h.played.uci)}>
                          {h.kind === 'dev' ? 'Im Repertoire' : h.kind === 'opp' ? 'Antwort festlegen' : 'Zug festlegen'}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {spots.length > 3 && (
                <button className="link-btn more-spots" onClick={() => setAllSpots((v) => !v)}>
                  {allSpots ? 'weniger anzeigen' : `alle ${spots.length} Brennpunkte`}
                </button>
              )}
              <div className="row-actions">
                {drill.length > 0 && (
                  <button className="btn primary" data-testid="drill" onClick={() => startDrill(drill)}>
                    <Icon name="train" /> Abweichungen trainieren ({drill.length})
                  </button>
                )}
                {unprepared > 0 && (
                  <button className="btn" onClick={() => setView('gaps')}>
                    <Icon name="gap" /> {unprepared} unvorbereitete Stellungen bei den Lücken
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {tab === 'list' && (
        <>
          <div className="seg small games-filter" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button
                key={f.k}
                aria-pressed={status === f.k}
                onClick={() => {
                  setStatus(f.k);
                  setLimit(40);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <ul className="games-list">
            {list.slice(0, limit).map((x) => {
              const r = x.rev;
              const sans = x.game.m.split(' ');
              const shown = r.ply !== undefined ? sans.slice(0, r.ply + 1) : sans.slice(0, 12);
              const marks = plyMarks(r, sans.length);
              const op = opening?.get(x.key);
              const a = assessOf(x.key);
              return (
                <li key={x.key} className={`game-row st-${r.status} ${a?.verdict === 'flag' ? 'flagged' : ''} ${sel.has(x.key) ? 'picked' : ''}`}>
                  <div className="game-head">
                    <input type="checkbox" className="game-pick" checked={sel.has(x.key)} onChange={() => toggleSel(x.key)} aria-label="Partie auswählen" />
                    <span className={`res r${x.game.r}`}>{x.game.r === 1 ? 'Sieg' : x.game.r === -1 ? 'Niederlage' : 'Remis'}</span>
                    <span className="game-opp">
                      {x.game.opp ? `gegen ${x.game.opp}` : 'Partie'}
                      {x.game.or ? <small> ({x.game.or})</small> : null}
                    </span>
                    <small className="hint">
                      {SOURCE_NAME[x.game.src ?? 'lichess']}
                      {x.game.sp ? ` · ${SPEED_NAME[x.game.sp]}` : ''}
                      {x.game.t ? ` · ${new Date(x.game.t).toLocaleDateString('de-DE')}` : ''}
                    </small>
                    {x.game.url && (
                      <a className="game-link" href={x.game.url} target="_blank" rel="noreferrer noopener" aria-label="Partie im Browser öffnen" title="Partie öffnen">
                        <Icon name="next" />
                      </a>
                    )}
                  </div>
                  <button className="game-open" onClick={() => openGame(x.key)} aria-label="Partie am Brett ansehen">
                    {op && <span className="game-opening">{nameDe(op)}</span>}
                    <span className="game-line">{formatLine(shown, notation)}</span>
                    <span className="ply-strip" aria-hidden>
                      {marks.map((m, i) => (
                        <i key={i} className={m} />
                      ))}
                    </span>
                  </button>
                  <p className={`game-status ${r.status}`}>
                    <b>{STATUS_TEXT[r.status]}</b>
                    <StatusDetail r={r} label={sanLabel} />
                  </p>
                  <VerdictBadge a={a} />
                  {r.mistake && (
                    <p className="game-status bad">
                      <b>Fehler</b> – {sanLabel(r.mistake.ply, r.mistake.san)} verliert ca. {fmt1(r.mistake.drop / 100)} Bauern (Lichess-Analyse)
                    </p>
                  )}
                  <div className="row-actions">
                    <button className="btn small primary" onClick={() => openGame(x.key)}>
                      Ansehen
                    </button>
                    {r.status !== 'in-rep' && fixAction(x)}
                  </div>
                </li>
              );
            })}
          </ul>
          {!list.length && <p className="hint">Keine Partien in dieser Auswahl.</p>}
          {list.length > limit && (
            <button className="btn small ghost" onClick={() => setLimit((l) => l + 40)}>
              Weitere {Math.min(40, list.length - limit)} anzeigen
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Zusatz zum Status: was genau passiert ist (Zug, Repertoirezug) */
export function StatusDetail({ r, label }: { r: GameReview; label: (ply: number, san: string) => string }) {
  if (r.ply === undefined || !r.played) return null;
  switch (r.status) {
    case 'my-deviation':
      return (
        <>
          {' '}
          – {label(r.ply, r.played.san)} statt <b className="me">{label(r.ply, r.rep!.san)}</b>
        </>
      );
    case 'opp-new':
      return <> – {label(r.ply, r.played.san)} kommt in deinem Repertoire nicht vor</>;
    case 'hole':
      return <> – bei {label(r.ply, r.played.san)} hattest du keinen festgelegten Zug</>;
    case 'end':
      return <> – ab {label(r.ply, r.played.san)} frei gespielt</>;
    default:
      return null;
  }
}
