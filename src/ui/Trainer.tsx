// Training (F5): Kontext vorspielen → eigener Zug → automatische FSRS-Bewertung.
// Reihenfolge aus core/session (keine Linie zweimal am Stück, Relearning genau einmal).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Board, uciSquares } from './Board';
import { currentRep, gotoPosKey, loadRepData, setView, useApp } from './store';
import { repo } from '../data/repo';
import { answer, createSession, currentStep, isFinished, type Session, type SessionItem } from '../core/session';
import { isDue, isNew, ratingFor, Scheduler } from '../core/srs';
import { displaySan, playUci, START_FEN, formatLine, moveNumberPrefix, plyOfFen } from '../core/chess';
import { buildPool, dueItems, eligibleNew, lineItems, newItems, type Focus } from './training';
import { pathSans, subtreeIds } from '../core/graph';
import { prefersReducedMotion } from './hooks';
import type { Card, ReviewLog, TrainingMode } from '../core/types';
import { Icon } from './Icon';
import { buzz } from './theme';
import { activeSession, beginSession, clearSession, pauseSession, persistSession, resumeSession, storedSession, type SavedSession } from './trainingSession';

type Phase = 'context' | 'ask' | 'right' | 'wrong' | 'fixed';

export function Trainer() {
  const rep = currentRep();
  const graph = useApp((s) => s.graph);
  const cards = useApp((s) => s.cards);
  const settings = useApp((s) => s.settings);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [focus, setFocus] = useState<Focus>({});
  // Laufende Sitzung überlebt Reiterwechsel (Speicher) und Neuladen (localStorage → „Fortsetzen“)
  const [saved, setSaved] = useState<SavedSession | undefined>(() => activeSession(rep?.id));
  const [stored, setStored] = useState<SavedSession | undefined>(() => (activeSession(rep?.id) ? undefined : storedSession(rep?.id)));
  const [version, setVersion] = useState(0);

  const [logsLoaded, setLogsLoaded] = useState(false);
  useEffect(() => {
    void repo.reviewsSince(Date.now() - 2 * 86400_000).then((l) => {
      setLogs(l);
      setLogsLoaded(true);
    });
  }, [saved, version]);

  const now = Date.now();
  const cardList = useMemo(() => [...cards.values()], [cards]);
  const pool = useMemo(() => buildPool(cardList, logs, settings, now, graph, focus), [cardList, logs, settings, graph, focus, now]);
  const due = useMemo(() => dueItems(pool, settings, now, graph), [pool, settings, now, graph]);
  const fresh = useMemo(() => newItems(pool, settings, graph), [pool, settings, graph]);
  const eligibleCount = useMemo(() => eligibleNew(pool, settings, graph).length, [pool, settings, graph]);
  const deferredCount = pool.fresh.length - eligibleCount; // unter der Mindest-Erreichbarkeit zurückgestellt
  // Über das Tageslimit hinaus: 10 weitere neue Karten (falls noch welche da sind)
  const extraNew = useMemo(() => (fresh.length === 0 && eligibleCount > 0 ? newItems(pool, settings, graph, 10) : []), [fresh.length, eligibleCount, pool, settings, graph]);

  // Fokus-Äste mit Anzahl fälliger Karten
  const families = useMemo(() => {
    if (!graph) return [];
    const dueKeys = new Set(cardList.filter((c) => !c.suspended && isDue(c.srs, now)).map((c) => c.posKey));
    const out: { id: number; label: string }[] = [];
    for (const n of graph.nodes) {
      if (n.ply === 2 && n.status !== 'transposition' && n.children.length) {
        const dueHere = subtreeIds(graph, n.id).filter((i) => dueKeys.has(graph.nodes[i].posKey)).length;
        out.push({ id: n.id, label: `${n.topFamily} (${formatLine(pathSans(graph, n.id), settings.ui.notation)})${dueHere ? ` · ${dueHere} fällig` : ''}` });
      }
    }
    return out;
  }, [graph, settings.ui.notation, cardList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vorschau: wie viele Wiederholungen in den nächsten Tagen kommen
  const forecast = useMemo(() => {
    const endOf = (days: number) => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.getTime() + days * 86400_000;
    };
    const learned = cardList.filter((c) => !c.suspended && !isNew(c.srs));
    const count = (to: number) => learned.filter((c) => c.srs.due > now && c.srs.due <= to).length;
    return { tomorrow: count(endOf(1)), week: count(endOf(7)), learned: learned.length };
  }, [cardList]); // eslint-disable-line react-hooks/exhaustive-deps

  // „Training starten“ auf der Startseite: direkt loslegen (fällige zuerst, sonst neue), sobald die Zahlen stehen
  useEffect(() => {
    if (!logsLoaded || !rep || saved || !useApp.getState().trainAuto) return;
    useApp.setState({ trainAuto: false });
    if (stored) return; // angefangene Sitzung hat Vorrang – Nutzer entscheidet
    if (due.length) start('due', due);
    else if (fresh.length) start('new', fresh);
  }, [logsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rep) return <p className="empty">Kein Repertoire ausgewählt.</p>;

  function start(mode: TrainingMode, items: SessionItem[]) {
    if (!items.length) return;
    if (!rep) return;
    setStored(undefined);
    setSaved(beginSession(rep.id, createSession(mode, items)));
  }

  const startLine = () => {
    if (!graph) return;
    const startId = focus.nodeId ?? 0;
    const items = lineItems(cardList, graph, startId);
    start('line', items);
  };

  if (saved) {
    return (
      <Runner
        key={saved.startedAt}
        saved={saved}
        onChange={() => setVersion((v) => v + 1)}
        onPause={() => {
          pauseSession();
          setStored(storedSession(rep.id));
          setSaved(undefined);
          void loadRepData();
        }}
        onExit={() => {
          clearSession();
          setSaved(undefined);
          void loadRepData();
        }}
        more={[
          ...(due.length ? [{ label: `Weiter wiederholen (${due.length})`, run: () => start('due', due) }] : []),
          ...(fresh.length
            ? [{ label: `Neue lernen (${fresh.length})`, run: () => start('new', fresh) }]
            : extraNew.length
              ? [{ label: `${extraNew.length} weitere neue`, run: () => start('new', extraNew) }]
              : []),
        ]}
      />
    );
  }

  return (
    <div className="page trainer-setup">
      <header className="page-head">
        <h1>Training</h1>
      </header>
      {stored && (
        <div className="resume card">
          <div>
            <b>Angefangene Sitzung</b>
            <small>
              {stored.session.mode === 'line' ? 'Linie' : stored.session.mode === 'new' ? 'Neu lernen' : 'Wiederholen'} · {stored.session.index} von{' '}
              {stored.session.steps.length} erledigt · {stored.stats.right} richtig, {stored.stats.wrong} falsch
            </small>
          </div>
          <div className="row-actions">
            <button
              className="btn primary"
              onClick={() => {
                setSaved(resumeSession(stored));
                setStored(undefined);
              }}
            >
              Fortsetzen
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                clearSession();
                setStored(undefined);
              }}
            >
              Verwerfen
            </button>
          </div>
        </div>
      )}
      {cardList.length === 0 && (
        <div className="empty card empty-cta">
          <Icon name="train" />
          <p>Noch nichts zu lernen: Lernkarten entstehen aus deinen eigenen Zügen. Lege Züge beim Bauen fest oder übernimm eine Studie.</p>
          <div className="row-actions center">
            <button className="btn primary" onClick={() => setView('build')}>Zum Bauen</button>
            <button
              className="btn"
              onClick={() => {
                useApp.setState({ studyId: undefined, studyAdd: true });
                setView('studies');
              }}
            >
              Studie hinzufügen
            </button>
          </div>
        </div>
      )}
      <div className="train-cards">
        {/* Nichts fällig: ruhige Kachel statt einer ausgegrauten Hauptkachel; dann ist „neu lernen“ der Hauptweg */}
        <button className={`tile ${due.length ? 'primary' : 'calm'}`} disabled={!due.length} onClick={() => start('due', due)}>
          {due.length ? <b>{due.length}</b> : <b><Icon name="check" /></b>}
          <span>{due.length ? 'fällig – wiederholen' : 'Nichts fällig'}</span>
          {pool.reviewsToday > 0 ? <small>heute schon {pool.reviewsToday} wiederholt</small> : !due.length && forecast.tomorrow > 0 ? <small>morgen wieder {forecast.tomorrow}</small> : null}
        </button>
        {fresh.length > 0 || !extraNew.length ? (
          <button className={`tile ${!due.length && fresh.length ? 'primary' : ''}`} disabled={!fresh.length} onClick={() => start('new', fresh)}>
            <b>{fresh.length}</b>
            <span>neu lernen</span>
            <small>
              {pool.fresh.length} neue insgesamt · max. {settings.srs.newPerDay}/Tag
              {deferredCount > 0 && ` · ${deferredCount} selten, zurückgestellt`}
            </small>
          </button>
        ) : (
          <button className="tile" onClick={() => start('new', extraNew)}>
            <b>+{extraNew.length}</b>
            <span>Extra-Runde neu lernen</span>
            <small>
              Tageslimit ({settings.srs.newPerDay}) erreicht · noch {eligibleCount} neue
              {deferredCount > 0 && ` · ${deferredCount} selten, zurückgestellt`}
            </small>
          </button>
        )}
        <button className="tile" disabled={!graph} onClick={startLine}>
          <b><Icon name="tree" /></b>
          <span>Linie üben</span>
          <small>eine zufällige Linie deines Repertoires von vorn durchspielen – nur Fehler zählen</small>
        </button>
      </div>
      {forecast.learned > 0 && (
        <p className="forecast">
          Gelernt: <b>{forecast.learned}</b> Stellungen · kommen wieder: morgen <b>{forecast.tomorrow}</b> · in 7 Tagen <b>{forecast.week}</b>
        </p>
      )}
      <section className="focus">
        <h2>Fokus</h2>
        <label className="field">
          <span>Ast</span>
          <select value={focus.nodeId ?? ''} onChange={(e) => setFocus({ ...focus, nodeId: e.target.value === '' ? undefined : Number(e.target.value) })}>
            <option value="">ganzes Repertoire</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={!!focus.onlyWeak} onChange={(e) => setFocus({ ...focus, onlyWeak: e.target.checked })} /> nur schwache Stellungen (Wissen rot, R &lt; 0,7)
        </label>
      </section>
      <details className="explain">
        <summary>
          <Icon name="info" /> So funktioniert das Training
        </summary>
        <p>
        Karteikarten-Prinzip (FSRS, wie Anki): Jede Stellung ist eine Karte. Weißt du sie, kommt sie in immer größeren Abständen wieder (Tage, Wochen, Monate),
        vergisst du sie, kommt sie bald wieder. Die Abstände werden so gewählt, dass du dich mit {Math.round(settings.srs.desiredRetention * 100)} % Wahrscheinlichkeit
        erinnerst (Behaltensziel in den Einstellungen). Ablauf: Die letzten {settings.srs.contextPlies} Halbzüge werden vorgespielt, dann spielst du deinen Zug.
        Bewertung automatisch: falsch = nochmal, &gt; {settings.srs.hardMs / 1000} s = schwer, &lt; {settings.srs.easyMs / 1000} s = leicht, sonst gut. Neue Karten:{' '}
        {settings.srs.newOrder === 'line' ? 'Linie für Linie' : 'wichtigste (häufigste) Stellungen zuerst'}. Funktioniert offline.
        </p>
      </details>
    </div>
  );
}

// ------------------------------------------------------------ Sitzung

function Runner({
  saved,
  onExit,
  onPause,
  onChange,
  more,
}: {
  saved: SavedSession;
  onExit: () => void;
  onPause: () => void;
  onChange: () => void;
  /** Angebote nach dem Ende („Weiter wiederholen“, „10 weitere neue“) */
  more: { label: string; run: () => void }[];
}) {
  const session: Session = saved.session;
  const startedAt = saved.startedAt;
  const rep = currentRep()!;
  const graph = useApp((s) => s.graph);
  const cards = useApp((s) => s.cards);
  const moves = useApp((s) => s.moves);
  const settings = useApp((s) => s.settings);
  const notation = settings.ui.notation;
  const [, force] = useState(0);
  const [phase, setPhase] = useState<Phase>('context');
  const [ctxIdx, setCtxIdx] = useState(0);
  const [wrongUci, setWrongUci] = useState<string | undefined>();
  const [boardFen, setBoardFen] = useState(START_FEN);
  const [lastUci, setLastUci] = useState<string | undefined>();
  const askAt = useRef(0);
  const [nextDue, setNextDue] = useState<number | undefined>();
  const lastReview = useRef<{ prev: Card; uid: string } | undefined>(undefined);
  const answered = useRef(false);
  const stats = useRef(saved.stats); // dasselbe Objekt wie in der gespeicherten Sitzung
  const scheduler = useMemo(() => new Scheduler(settings.srs.desiredRetention), [settings.srs.desiredRetention]);
  // Fokus-Modus am Handy: Brett ganz oben. Block-Körper nötig – scrollTo gibt in neuem Chromium ein Promise zurück,
  // das React sonst als Aufräumfunktion aufrufen würde (Absturz).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const step = currentStep(session);
  const card = step ? [...cards.values()].find((c) => c.id === step.cardId) : undefined;
  const move = card ? moves.get(card.posKey) : undefined;
  const item = step ? session.items[step.cardId] : undefined;

  // Kontext: Stellungen entlang des Pfads, letzte contextPlies Halbzüge.
  // Nur an stabile Werte gekoppelt – sonst würde das Speichern der Bewertung (neues Kartenobjekt
  // im Store) den Schritt zurücksetzen und die Stellung erneut vorspielen.
  const cardId = card?.id;
  const moveFen = move?.fen;
  const hasMove = !!move;
  const rootFen = graph?.nodes[0].fen ?? START_FEN;
  const context = useMemo(() => {
    if (!cardId || !hasMove || !moveFen) return [] as { fen: string; uci?: string }[];
    const path = item?.path;
    if (!path) return [{ fen: moveFen }];
    const fens: { fen: string; uci?: string }[] = [{ fen: rootFen }];
    try {
      for (const u of path) {
        const p = playUci(fens[fens.length - 1].fen, u);
        fens.push({ fen: p.fen, uci: p.uci });
      }
    } catch {
      return [{ fen: moveFen }];
    }
    return fens.slice(Math.max(0, fens.length - 1 - settings.srs.contextPlies));
  }, [cardId, hasMove, moveFen, item, rootFen, settings.srs.contextPlies]);

  // Neuer Schritt → Kontext abspielen
  useEffect(() => {
    if (!step || !context.length) return;
    answered.current = false;
    setNextDue(undefined);
    setWrongUci(undefined);
    setPhase('context');
    const instant = prefersReducedMotion() || context.length === 1;
    const startIdx = instant ? context.length - 1 : 0;
    setCtxIdx(startIdx);
    setBoardFen(context[startIdx].fen);
    setLastUci(context[startIdx].uci);
    if (instant) {
      setPhase('ask');
      askAt.current = performance.now();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.index, step?.cardId, context]);

  useEffect(() => {
    if (phase !== 'context' || ctxIdx >= context.length - 1) return;
    const t = setTimeout(() => {
      const i = ctxIdx + 1;
      setCtxIdx(i);
      setBoardFen(context[i].fen);
      setLastUci(context[i].uci);
      if (i >= context.length - 1) {
        setPhase('ask');
        askAt.current = performance.now();
      }
    }, ctxIdx === 0 ? 650 : 520);
    return () => clearTimeout(t);
  }, [phase, ctxIdx, context]);

  // Karten ohne Eintrag (gelöscht) überspringen
  useEffect(() => {
    if (step && (!card || !move)) {
      answer(session, true);
      force((x) => x + 1);
    }
  }, [step, card, move, session]);

  // Antwort wird erst beim Weitergehen an die Sitzung gemeldet (sonst springt die Anzeige sofort zur nächsten Karte)
  const pendingAnswer = useRef<boolean | undefined>(undefined);
  const next = useCallback(() => {
    if (pendingAnswer.current === undefined) return;
    answer(session, pendingAnswer.current);
    pendingAnswer.current = undefined;
    persistSession(saved);
    force((x) => x + 1);
    onChange();
  }, [onChange, session]);

  const record = async (correct: boolean, ms: number, wrong?: string) => {
    if (!card || !step) return;
    const rating = ratingFor(correct, ms, settings.srs);
    const mode = session.mode;
    // Linien-Modus: nur Fehler fließen in FSRS ein (bewusst dieselbe Linie am Stück)
    if (mode === 'line' && correct) return;
    const fresh = await repo.db.cards.get(card.id);
    if (!fresh) return;
    const srs = scheduler.review(fresh.srs, mode === 'line' ? 1 : rating, Date.now());
    if (correct) setNextDue(srs.due);
    const uid = await repo.saveReview(fresh, srs, {
      cardId: card.id,
      repertoireId: rep.id,
      posKey: card.posKey,
      at: Date.now(),
      rating: mode === 'line' ? 1 : rating,
      correct,
      msToAnswer: Math.round(ms),
      wrongMoveUci: wrong,
      mode,
    });
    lastReview.current = { prev: fresh, uid };
    useApp.setState((s) => {
      const m = new Map(s.cards);
      m.set(card.posKey, { ...fresh, srs });
      return { cards: m };
    });
  };

  // „Verklickt“: falsche Bewertung zurücknehmen und als richtig werten (ohne Relearning in dieser Sitzung)
  const misclick = async () => {
    const lr = lastReview.current;
    if (!lr || !move || phase !== 'wrong') return;
    lastReview.current = undefined;
    await repo.undoReview(lr.prev, lr.prev.srs, lr.uid);
    stats.current.wrong = Math.max(0, stats.current.wrong - 1);
    stats.current.right++;
    // Als „gut“ werten (Zeit nicht mehr aussagekräftig)
    await record(true, (settings.srs.easyMs + settings.srs.hardMs) / 2);
    pendingAnswer.current = true;
    setWrongUci(undefined);
    setPhase('fixed');
  };

  const onMove = (uci: string) => {
    if (!move || !step) return;
    const questionFen = context[context.length - 1].fen;
    let played;
    try {
      played = playUci(questionFen, uci);
    } catch {
      return;
    }
    const correct = played.uci === move.uci;

    if (step.kind === 'show' || phase === 'wrong') {
      // Nachspielen des richtigen Zugs
      if (correct) {
        setBoardFen(played.fen);
        setLastUci(played.uci);
        setPhase('fixed');
        if (step.kind === 'show') {
          pendingAnswer.current = true;
          setTimeout(() => next(), 500);
        }
      } else {
        setBoardFen(questionFen);
      }
      return;
    }
    if (phase !== 'ask' || answered.current) return;
    answered.current = true;
    const ms = performance.now() - askAt.current;
    void record(correct, ms, correct ? undefined : played.uci);
    pendingAnswer.current = correct;
    buzz(correct ? 12 : [35, 60, 35]);
    if (correct) {
      stats.current.right++;
      setBoardFen(played.fen);
      setLastUci(played.uci);
      setPhase('right');
      if (!move.note) setTimeout(() => next(), 750);
    } else {
      stats.current.wrong++;
      setWrongUci(played.uci);
      setBoardFen(questionFen);
      setLastUci(context[context.length - 1].uci);
      setPhase('wrong');
    }
  };

  useEffect(
    () => () => {
      if (pendingAnswer.current !== undefined) {
        answer(session, pendingAnswer.current);
        pendingAnswer.current = undefined;
      }
      persistSession(saved);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Enter = weiter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (phase === 'right' || phase === 'fixed')) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, next]);

  if (isFinished(session)) {
    const dur = Math.round((Date.now() - startedAt) / 1000);
    const total = stats.current.right + stats.current.wrong;
    return (
      <div className="page trainer-done">
        <DoneMoment rate={total ? stats.current.right / total : 0} total={total} />
        <h1>Sitzung beendet</h1>
        <div className="train-cards">
          <div className="tile"><b>{stats.current.right}</b><span>richtig</span></div>
          <div className="tile"><b>{stats.current.wrong}</b><span>falsch</span></div>
          <div className="tile"><b>{total ? Math.round((100 * stats.current.right) / total) : 0} %</b><span>Trefferquote</span></div>
          <div className="tile"><b>{Math.floor(dur / 60)}:{String(dur % 60).padStart(2, '0')}</b><span>Dauer</span></div>
        </div>
        <div className="row-actions center">
          {more.map((m) => (
            <button key={m.label} className="btn big" onClick={m.run}>
              {m.label}
            </button>
          ))}
          <button className="btn primary big" onClick={onExit}>Fertig</button>
        </div>
      </div>
    );
  }

  if (!step || !card || !move) return <p className="hint pad">…</p>;

  const isShow = step.kind === 'show';
  const questionFen = context[context.length - 1]?.fen ?? move.fen;
  const ply = plyOfFenSafe(questionFen);
  const shapes: DrawShape[] = [];
  const correctSq = uciSquares(move.uci);
  if ((isShow && phase !== 'context') || phase === 'wrong') {
    if (correctSq) shapes.push({ orig: correctSq[0], dest: correctSq[1], brush: 'mine' });
    const w = uciSquares(wrongUci);
    if (w && phase === 'wrong') shapes.push({ orig: w[0], dest: w[1], brush: 'wrong' });
  }
  const askable = phase === 'ask' || phase === 'wrong' || (isShow && phase !== 'context' && phase !== 'fixed');
  const progress = session.index / session.steps.length;
  const highlights = phase === 'right' && correctSq ? new Map<Key, string>([[correctSq[1], 'flash-ok']]) : undefined;

  return (
    <div
      className="trainer"
      data-step-kind={step.kind}
      data-attempt={step.attempt}
      data-card={card.id}
      data-phase={phase}
      data-answer={import.meta.env.DEV ? move.uci : undefined}
      data-orientation={rep.color}
    >
      <div className="train-top">
        <button className="btn ghost small" onClick={onPause} title="Sitzung unterbrechen – später an derselben Stelle fortsetzen">Pause</button>
        <div className="progress" aria-label={`Fortschritt ${session.index} von ${session.steps.length}`}>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="count">{session.index + 1}/{session.steps.length}</span>
      </div>
      <div className="train-board">
        <Board
          fen={boardFen}
          orientation={rep.color}
          lastMove={uciSquares(lastUci)}
          movable={askable ? rep.color : 'none'}
          shapes={shapes}
          onMove={onMove}
          highlights={highlights}
          animationMs={180}
        />
      </div>
      <div className={`train-feedback ${phase}`} aria-live="polite">
        {phase === 'context' && <p className="hint">Stellung entsteht …</p>}
        {phase === 'ask' && !isShow && (
          <p className="q">
            {step.attempt === 2 ? 'Nochmal: ' : ''}Dein Zug? <span className="hint">{session.mode === 'line' ? 'Linie' : session.mode === 'new' ? 'Neu' : 'Wiederholung'}</span>
          </p>
        )}
        {isShow && phase !== 'context' && phase !== 'fixed' && (
          <div>
            <p className="q">
              Neu: Hier spielst du <b className="me">{moveNumberPrefix(ply) + displaySan(move.san, notation)}</b> – spiel ihn nach.
            </p>
            {move.note && <p className="note">{move.note}</p>}
          </div>
        )}
        {phase === 'right' && (
          <div>
            <p className="ok big"><Icon name="check" />Richtig</p>
            {nextDue !== undefined && <p className="hint next-due">Kommt wieder {dueLabel(nextDue)}.</p>}
            {move.note && <p className="note">{move.note}</p>}
            {move.note && <button className="btn primary big" onClick={next}>Weiter</button>}
          </div>
        )}
        {phase === 'wrong' && (
          <div>
            <p className="bad big"><Icon name="x" />Richtig ist {moveNumberPrefix(ply) + displaySan(move.san, notation)}</p>
            <p className="hint">Spiel den richtigen Zug nach. Die Stellung kommt in dieser Sitzung noch einmal.</p>
            {session.mode !== 'line' && (
              <button className="link-btn" onClick={() => void misclick()} title="Bewertung zurücknehmen und als richtig werten">
                Verklickt – ich wusste den Zug
              </button>
            )}
            {move.note && <p className="note">{move.note}</p>}
          </div>
        )}
        {phase === 'fixed' && !isShow && (
          <div>
            <p className="ok">Gut – gemerkt.</p>
            <button className="btn primary big" onClick={next}>Weiter</button>
          </div>
        )}
        <button className="link-btn small" onClick={() => { gotoPosKey(card.posKey, move.fen); setView('build'); }}>
          Stellung im Repertoire öffnen
        </button>
      </div>
    </div>
  );
}

/** Abschluss: Häkchen zeichnet sich; bei guter Quote (≥ 80 %, mind. 3 Karten) einmal Konfetti. */
function DoneMoment({ rate, total }: { rate: number; total: number }) {
  useEffect(() => {
    if (total < 3 || rate < 0.8) return;
    const t = setTimeout(confetti, 450); // nach dem Häkchen; Abbruch verhindert doppeltes Konfetti (StrictMode)
    return () => clearTimeout(t);
  }, [rate, total]);
  return (
    <svg className="done-check" viewBox="0 0 92 92" aria-hidden>
      <circle cx="46" cy="46" r="40" pathLength={1} />
      <path d="M28 47l12 12 24-26" pathLength={1} />
    </svg>
  );
}

/** Konfetti-Schnipsel per Web Animations (räumt sich selbst auf, respektiert „weniger Bewegung“). */
function confetti() {
  if (prefersReducedMotion() || typeof document.body.animate !== 'function') return;
  const box = document.createElement('div');
  box.className = 'confetti';
  document.body.appendChild(box);
  const css = getComputedStyle(document.documentElement);
  const colors = ['--acc', '--me', '--opp', '--gap'].map((v) => css.getPropertyValue(v).trim() || '#1b75b7');
  const w = window.innerWidth;
  for (let i = 0; i < 70; i++) {
    const el = document.createElement('i');
    el.style.left = `${w / 2 + (Math.random() - 0.5) * 80}px`;
    el.style.top = '38%';
    el.style.background = colors[i % colors.length];
    box.appendChild(el);
    const dx = (Math.random() - 0.5) * w * 0.9;
    const dy = -(160 + Math.random() * 260);
    el.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy + 520}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' },
    );
  }
  setTimeout(() => box.remove(), 2600);
}

/** „in 3 Tagen“, „morgen“, „in 10 Minuten“ – für die Anzeige nach einer Antwort. */
function dueLabel(due: number): string {
  const ms = due - Date.now();
  const min = Math.round(ms / 60000);
  if (min < 60) return min <= 1 ? 'in einer Minute' : `in ${min} Minuten`;
  const h = Math.round(ms / 3600000);
  if (h < 20) return h === 1 ? 'in einer Stunde' : `in ${h} Stunden`;
  const d = Math.round(ms / 86400000);
  if (d <= 1) return 'morgen';
  if (d < 45) return `in ${d} Tagen`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `in ${mo} Monaten` : 'in über einem Jahr';
}

function plyOfFenSafe(fen: string) {
  try {
    return plyOfFen(fen);
  } catch {
    return 0;
  }
}
