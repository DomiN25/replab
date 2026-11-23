// Partien: meine geladenen Partien (Lichess/Chess.com) gegen das Repertoire prüfen. Gezielt auswählen (Gegner, Zeitraum, Tempo,
// Eröffnung, Ergebnis, einzelne Partien), auswerten (wer verlässt die Vorbereitung wie oft und ab welchem Zug, mit welchem Ergebnis),
// Brennpunkte finden und daraus lernen: Partie am Brett ansehen, Abweichungen trainieren, Unvorbereitetes im Repertoire schließen.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { displaySan, formatLine, moveNumberPrefix } from '../core/chess';
import { hotspots, openingOf, plyMarks, summarize, type GameReview, type Hotspot, type ReviewStatus } from '../core/gameReview';
import { SPEED_NAME, type Speed } from '../core/opponentStats';
import { familyDe, nameDe } from '../core/openings';
import type { SessionItem } from '../core/session';
import { formatEval } from '../core/relevance';
import { engine, lichessToken, lineFromUcis, selectRepertoire, setLine, setView, toast, useApp } from './store';
import { loadMyGames, SOURCE_NAME, useMyGames, type GameSource } from './games';
import { useEco, useReviewedGames, type Row } from './gameRows';
import { GameDetail } from './GameDetail';
import { Icon } from './Icon';
import { useInert } from './inert';

type Filter = 'all' | 'dev' | 'opp' | 'hole' | 'mistake';
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'Alle' },
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

interface Check {
  repCp?: number;
  repMate?: number;
  playedCp?: number;
  playedMate?: number;
  busy?: boolean;
}

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

export function Games() {
  const stored = useMyGames();
  const { rows, color, loaded } = useReviewedGames();
  const reps = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  const cards = useApp((s) => s.cards);
  const settings = useApp((s) => s.settings);
  const notation = settings.ui.notation;
  const rep = reps.find((r) => r.id === repId);
  const eco = useEco(loaded);

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
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [loading, setLoading] = useState(false);
  const [allSpots, setAllSpots] = useState(false);

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

  // Filter ohne Status: daraus Auswertung und Brennpunkte
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
  const selected = useMemo(() => base.filter((r) => sel.has(r.key)), [base, sel]);
  const scope = selected.length ? selected : base;
  const sum = useMemo(() => summarize(scope), [scope]);
  const spots = useMemo(() => hotspots(scope, 6), [scope]);
  const listBase = onlySel && selected.length ? selected : base;
  const list = listBase.filter((r) =>
    status === 'all'
      ? true
      : status === 'dev'
        ? r.rev.status === 'my-deviation'
        : status === 'opp'
          ? r.rev.status === 'opp-new'
          : status === 'hole'
            ? r.rev.status === 'hole'
            : !!r.rev.mistake,
  );
  const anyFilter = !!(q || period || speed || fam || result || src);

  // Training: Stellungen, in denen ich abgewichen bin und eine Lernkarte habe (je Stellung einmal, häufigste zuerst)
  const drill = useMemo(() => {
    const m = new Map<string, SessionItem>();
    for (const r of scope) {
      if (r.rev.status !== 'my-deviation' || !r.rev.keyAt) continue;
      const card = cards.get(r.rev.keyAt);
      if (!card || card.suspended) continue;
      const cur = m.get(r.rev.keyAt);
      if (cur) cur.priority++;
      else m.set(r.rev.keyAt, { cardId: card.id, posKey: card.posKey, path: r.rev.prefix, priority: 1 });
    }
    return [...m.values()].sort((a, b) => b.priority - a.priority);
  }, [scope, cards]);
  const unprepared = useMemo(() => new Set(scope.filter((r) => r.rev.status === 'opp-new' || r.rev.status === 'hole').map((r) => `${r.rev.keyAt}|${r.rev.played?.uci}`)).size, [scope]);

  const sanLabel = (ply: number, san: string) => moveNumberPrefix(ply) + displaySan(san, notation);

  /** Stockfish: Repertoirezug gegen gespielten Zug an der Abweichung (lokal, flach genug für das Handy) */
  const check = async (x: Row) => {
    const r = x.rev;
    if (!r.fenAt || !r.rep || !r.played) return;
    setChecks((c) => ({ ...c, [x.key]: { busy: true } }));
    try {
      const run = (searchmoves: string[]) => engine().analyse(r.fenAt!, { depth: 14, multipv: 1, searchmoves }, () => {}).done;
      const a = await run([r.rep.uci]);
      const b = await run([r.played.uci]);
      setChecks((c) => ({
        ...c,
        [x.key]: { repCp: a?.lines[0]?.cp, repMate: a?.lines[0]?.mate, playedCp: b?.lines[0]?.cp, playedMate: b?.lines[0]?.mate },
      }));
    } catch {
      setChecks((c) => ({ ...c, [x.key]: {} }));
      toast('Stockfish konnte die Stelle nicht prüfen.', 'err');
    }
  };

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
  const resetFilters = () => {
    setQ('');
    setPeriod(0);
    setSpeed('');
    setFam('');
    setResult('');
    setSrc('');
    setLimit(40);
  };
  /** Brennpunkt → Liste auf genau diese Partien einschränken */
  const focusSpot = (h: Hotspot) => {
    setSel(new Set(h.idx.map((i) => scope[i].key)));
    setOnlySel(true);
    setStatus('all');
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
            deiner Vorbereitung abweichen.
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

  const openIdx = openKey ? list.findIndex((r) => r.key === openKey) : -1;
  if (openKey && openIdx >= 0)
    return (
      <GameDetail
        rows={list}
        index={openIdx}
        color={color}
        opening={(k) => opening?.get(k)}
        onIndex={(i) => setOpenKey(list[i].key)}
        onClose={() => setOpenKey(undefined)}
      />
    );

  const pct = (n: number) => (sum.games ? Math.round((100 * n) / sum.games) : 0);

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
        Gegen „{rep?.name}“: {rows.length} {rows.length === 1 ? 'Partie' : 'Partien'} mit {color === 'white' ? 'Weiß' : 'Schwarz'} (Eröffnung bis Zug 15).
      </p>

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
                      <button className="ge-row" aria-pressed={status === e.filter} onClick={() => setStatus(status === e.filter ? 'all' : e.filter!)}>
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
              {sum.mistakes > 0 && (
                <>
                  {' '}
                  <button className="link-btn" onClick={() => setStatus('mistake')}>
                    {sum.mistakes} {sum.mistakes === 1 ? 'Fehler' : 'Fehler'} in der Eröffnung
                  </button>{' '}
                  (Lichess-Analyse).
                </>
              )}
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
          const ck = checks[x.key];
          const marks = plyMarks(r, sans.length);
          const op = opening?.get(x.key);
          return (
            <li key={x.key} className={`game-row st-${r.status} ${sel.has(x.key) ? 'picked' : ''}`}>
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
              {r.mistake && (
                <p className="game-status bad">
                  <b>Fehler</b> – {sanLabel(r.mistake.ply, r.mistake.san)} verliert ca. {fmt1(r.mistake.drop / 100)} Bauern (Lichess-Analyse)
                </p>
              )}
              {ck && !ck.busy && (ck.repCp !== undefined || ck.repMate !== undefined) && (
                <p className="game-status">
                  Stockfish: Repertoirezug <b>{formatEval(ck.repCp, ck.repMate)}</b>, gespielter Zug <b>{formatEval(ck.playedCp, ck.playedMate)}</b>
                  {ck.repCp !== undefined && ck.playedCp !== undefined && ck.repCp - ck.playedCp >= 100 && <b className="bad"> – das war ein Fehler</b>}
                  {ck.repCp !== undefined && ck.playedCp !== undefined && ck.repCp - ck.playedCp < 30 && <> – gleichwertig</>}
                </p>
              )}
              <div className="row-actions">
                <button className="btn small primary" onClick={() => openGame(x.key)}>
                  Ansehen
                </button>
                <button
                  className="btn small"
                  onClick={() => openInRepertoire(r.prefix, r.status === 'my-deviation' || r.status === 'opp-new' ? r.played?.uci : undefined)}
                  disabled={r.status === 'in-rep'}
                >
                  Im Repertoire öffnen
                </button>
                {r.status === 'my-deviation' && !x.game.ev && (
                  <button className="btn small ghost" disabled={ck?.busy} onClick={() => void check(x)}>
                    {ck?.busy ? 'Prüfe …' : 'Mit Stockfish prüfen'}
                  </button>
                )}
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
