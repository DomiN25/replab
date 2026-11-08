// Training (F5): Kontext vorspielen → eigener Zug → automatische FSRS-Bewertung.
// Reihenfolge aus core/session (keine Linie zweimal am Stück, Relearning genau einmal).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Board, uciSquares } from './Board';
import { currentRep, gotoPosKey, loadRepData, setView, useApp } from './store';
import { repo } from '../data/repo';
import { answer, createSession, currentStep, isFinished, type Session, type SessionItem } from '../core/session';
import { ratingFor, Scheduler } from '../core/srs';
import { displaySan, playUci, START_FEN, formatLine, moveNumberPrefix, plyOfFen } from '../core/chess';
import { buildPool, dueItems, lineItems, newItems, type Focus } from './training';
import { pathSans } from '../core/graph';
import { prefersReducedMotion } from './hooks';
import type { ReviewLog, TrainingMode } from '../core/types';
import { Icon } from './Icon';
import { buzz } from './theme';

type Phase = 'context' | 'ask' | 'right' | 'wrong' | 'fixed';

export function Trainer() {
  const rep = currentRep();
  const graph = useApp((s) => s.graph);
  const cards = useApp((s) => s.cards);
  const settings = useApp((s) => s.settings);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [focus, setFocus] = useState<Focus>({});
  const [session, setSession] = useState<Session | undefined>();
  const [version, setVersion] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    void repo.reviewsSince(Date.now() - 2 * 86400_000).then(setLogs);
  }, [session, version]);

  const now = Date.now();
  const cardList = useMemo(() => [...cards.values()], [cards]);
  const pool = useMemo(() => buildPool(cardList, logs, settings, now, graph, focus), [cardList, logs, settings, graph, focus, now]);
  const due = useMemo(() => dueItems(pool, settings, now, graph), [pool, settings, now, graph]);
  const fresh = useMemo(() => newItems(pool, settings, graph), [pool, settings, graph]);

  const families = useMemo(() => {
    if (!graph) return [];
    const out: { id: number; label: string }[] = [];
    for (const n of graph.nodes) {
      if (n.ply === 2 && n.status !== 'transposition' && n.children.length) out.push({ id: n.id, label: `${n.topFamily} (${formatLine(pathSans(graph, n.id), settings.ui.notation)})` });
    }
    return out;
  }, [graph, settings.ui.notation]);

  if (!rep) return <p className="empty">Kein Repertoire ausgewählt.</p>;

  const start = (mode: TrainingMode, items: SessionItem[]) => {
    if (!items.length) return;
    startedAt.current = Date.now();
    setSession(createSession(mode, items));
  };

  const startLine = () => {
    if (!graph) return;
    const startId = focus.nodeId ?? 0;
    const items = lineItems(cardList, graph, startId);
    start('line', items);
  };

  if (session) {
    return (
      <Runner
        key={startedAt.current}
        session={session}
        onChange={() => setVersion((v) => v + 1)}
        onExit={() => {
          setSession(undefined);
          void loadRepData();
        }}
        startedAt={startedAt.current}
      />
    );
  }

  return (
    <div className="page trainer-setup">
      <header className="page-head">
        <h1>Training</h1>
        <p className="sub">{rep.name}</p>
      </header>
      <div className="train-cards">
        <button className="tile primary" disabled={!due.length} onClick={() => start('due', due)}>
          <b>{due.length}</b>
          <span>fällig – Wiederholen</span>
          {pool.reviewsToday > 0 && <small>heute schon {pool.reviewsToday}</small>}
        </button>
        <button className="tile" disabled={!fresh.length} onClick={() => start('new', fresh)}>
          <b>{fresh.length}</b>
          <span>neu lernen</span>
          <small>
            {pool.fresh.length} neue insgesamt · max. {settings.srs.newPerDay}/Tag
          </small>
        </button>
        <button className="tile" disabled={!graph} onClick={startLine}>
          <b><Icon name="tree" /></b>
          <span>Linie durchspielen</span>
          <small>zufällige Linie im Fokus, in Zugreihenfolge</small>
        </button>
      </div>
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
      <p className="hint">
        Ablauf: Die letzten {settings.srs.contextPlies} Halbzüge werden vorgespielt, dann spielst du deinen Zug. Bewertung automatisch: falsch = Again, &gt;{' '}
        {settings.srs.hardMs / 1000} s = Hard, &lt; {settings.srs.easyMs / 1000} s = Easy, sonst Good. Falsche Karten kommen in der Sitzung genau einmal später wieder.
        Funktioniert offline.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ Sitzung

function Runner({ session, onExit, onChange, startedAt }: { session: Session; onExit: () => void; onChange: () => void; startedAt: number }) {
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
  const answered = useRef(false);
  const stats = useRef({ right: 0, wrong: 0 });
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
    await repo.saveReview(fresh, srs, {
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
    useApp.setState((s) => {
      const m = new Map(s.cards);
      m.set(card.posKey, { ...fresh, srs });
      return { cards: m };
    });
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
        <button className="btn primary big" onClick={onExit}>Fertig</button>
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
        <button className="btn ghost small" onClick={onExit}>Beenden</button>
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
            {move.note && <p className="note">{move.note}</p>}
            {move.note && <button className="btn primary big" onClick={next}>Weiter</button>}
          </div>
        )}
        {phase === 'wrong' && (
          <div>
            <p className="bad big"><Icon name="x" />Richtig ist {moveNumberPrefix(ply) + displaySan(move.san, notation)}</p>
            <p className="hint">Spiel den richtigen Zug nach. Die Stellung kommt in dieser Sitzung noch einmal.</p>
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

function plyOfFenSafe(fen: string) {
  try {
    return plyOfFen(fen);
  } catch {
    return 0;
  }
}
