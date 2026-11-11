// Lernmodus der Studien: geführt Linie für Linie durch die Studie (Algorithmus in core/studyLines.ts).
// Zustand liegt in der Studie (learn, linesDone, cards) und wird mit ihr gespeichert und synchronisiert.
// Zwischenabfragen: „Verstanden“ legt Lernkarten an (core/studyCards.ts); alle n Linien kommt eine kurze Abfrage.
// Die Studienansicht (Studies.tsx) zeichnet Brett und Zugleiste; dieser Baustein liefert Zustand, Aktionen,
// die Bedienleiste unter dem Brett, die Linienkarte und den Plan.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { displaySan, moveNumberPrefix, plyOfFen, turnOf } from '../core/chess';
import { cutKey, type ExistingEntry, type StudyTree } from '../core/pgn';
import type { NodeView, PathStep } from '../core/study';
import { buildLinePlan, levelName, lineForMove, nextOpenLine, type LineOrder, type LinePlan, type StudyLine } from '../core/studyLines';
import type { Study } from '../core/types';
import { addLineCards, buildRound, CHECK_LOAD, checkCount, freshLoad, linePositions, type CheckItem, type CheckPace } from '../core/studyCards';
import { ratingFor, Scheduler } from '../core/srs';
import { AUTO_SPEEDS, autoDelay, autoNext, leadFor, type AutoSpeed } from '../core/autoplay';
import { useApp } from './store';
import { repo } from '../data/repo';
import { Icon } from './Icon';
import { RowMenu } from './RowMenu';
import { toast } from './store';
import { buzz } from './theme';

type LearnState = NonNullable<Study['learn']>;

/** Laufende Zwischenabfrage (nicht gespeichert – eine Runde ist kurz) */
export interface CheckRun {
  items: CheckItem[];
  i: number;
  t0: number;
  /** ask = Zug gesucht, wrong = falsch (Pfeil zeigt den richtigen), right = richtig */
  phase: 'ask' | 'wrong' | 'right';
  right: number;
  finished: boolean;
}

export interface Learn {
  on: boolean;
  plan: LinePlan;
  idx: number;
  line: StudyLine;
  step: number;
  atEnd: boolean;
  done: Set<string>;
  order: LineOrder;
  selfPlay: boolean;
  /** nächster Zug der Linie (undefined am Ende) */
  expected?: PathStep;
  /** eigener Zug ist dran und soll selbst gefunden werden */
  quiz: boolean;
  /** Zurück möglich (Schritt, Verlauf oder Abzweig davor) */
  canPrev: boolean;
  /** nächste offene Linie nach dieser (für die Vorschau am Linienende) */
  nextIdx?: number;
  hint: boolean;
  /** Geführtes Abspielen: Linie läuft von allein (Interrupt: jede Bedienung hält an) */
  playing: boolean;
  /** Orientierungszüge vor dem Abzweig laufen gerade */
  leading: boolean;
  speed: AutoSpeed;
  autoToggle: () => void;
  autoStop: () => void;
  setSpeed: (s: AutoSpeed) => void;
  setOn: (on: boolean, here?: string) => void;
  setOrder: (o: LineOrder) => void;
  setSelfPlay: (b: boolean) => void;
  goto: (i: number, step?: number) => void;
  next: () => void;
  prev: () => void;
  markDone: () => void;
  again: () => void;
  skip: () => void;
  cutLine: () => void;
  cutRest: () => void;
  /** Linie i samt Untervarianten entfernen (Planliste) */
  removeLine: (i: number) => void;
  /** Zug am Brett/aus der Leiste; liefert false, wenn der Zug zu keiner Linie gehört */
  play: (uci: string) => boolean;
  // Zwischenabfragen
  check?: CheckRun;
  checkOn: boolean;
  checkPace: CheckPace;
  /** Lernlast seit der letzten Abfrage und Schwellwert (für die Anzeige im Plan) */
  checkLoad: { load: number; fresh: number; threshold: number };
  /** Anzahl abfragbarer Karten (neu oder fällig) */
  checkAvailable: number;
  startCheck: () => void;
  checkMove: (uci: string) => void;
  checkGiveUp: () => void;
  checkNext: () => void;
  endCheck: () => void;
  setCheckOn: (b: boolean) => void;
  setCheckPace: (p: CheckPace) => void;
}

export function useLearn(p: {
  tree?: StudyTree;
  st?: Study;
  active: Set<number>;
  existing: Map<string, ExistingEntry>;
  update: (patch: Partial<Study>) => void;
  setPath: (path: PathStep[]) => void;
}): Learn | undefined {
  const { tree, st, active, existing, update, setPath } = p;
  const order: LineOrder = st?.learn?.order ?? 'skeleton';
  const plan = useMemo(
    () => (tree && st ? buildLinePlan(tree, st, active, existing, order) : undefined),
    [tree, st?.cuts, st?.choices, st?.color, active, existing, order], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const done = useMemo(() => new Set(st?.linesDone ?? []), [st?.linesDone]);
  const on = !!st && st.learn?.on !== false; // Standard: Lernen
  const selfPlay = !!st?.learn?.selfPlay;
  const [hint, setHint] = useState(false);
  // Geführtes Abspielen: nicht gespeichert (Neustart der Seite = angehalten). lead = noch auszublendende Orientierungszüge
  const [playing, setPlaying] = useState(false);
  const [lead, setLead] = useState(0);
  const speed: AutoSpeed = st?.learn?.speed ?? 'normal';
  const [check, setCheck] = useState<CheckRun | undefined>();
  const srsSet = useApp((s) => s.settings.srs);
  const scheduler = useMemo(() => new Scheduler(srsSet.desiredRetention), [srsSet.desiredRetention]);
  // Stellungen, die das Ziel-Repertoire schon mit demselben Zug hat, übt das normale Training
  const inRep = (key: string, uci: string) => existing.get(key)?.uci === uci;
  const loadInfo = useMemo(
    () => (plan && st?.cards ? freshLoad(st.cards, plan, inRep) : { load: 0, fresh: [] }),
    [plan, st?.cards, existing], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const checkAvailable = useMemo(
    () => (plan && st?.cards ? checkCount(st.cards, plan, Date.now(), inRep) : 0),
    [plan, st?.cards, existing], // eslint-disable-line react-hooks/exhaustive-deps
  );

  let idx = -1;
  let step = 0;
  if (plan?.lines.length) {
    idx = plan.byId.get(st?.learn?.line ?? 'main') ?? nextOpenLine(plan, done, -1) ?? 0;
    step = Math.min(Math.max(0, st?.learn?.step ?? 0), plan.lines[idx].steps.length);
  }
  const line = idx >= 0 ? plan!.lines[idx] : undefined;
  const learnPath = useMemo(() => (line ? [...line.start, ...line.steps.slice(0, step)] : []), [line, step]);
  // Brett folgt der Lernposition – während einer Abfrage der abgefragten Stellung
  const checkItem = check && !check.finished ? check.items[check.i] : undefined;
  useEffect(() => {
    if (!on) return;
    if (checkItem) setPath(checkItem.path);
    else if (line) setPath(lead > 0 ? line.start.slice(0, Math.max(0, line.start.length - lead)) : learnPath);
  }, [on, learnPath, checkItem, lead]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) {
      setCheck(undefined);
      setPlaying(false);
      setLead(0);
    }
  }, [on]);
  // Linie wechselt von außen (Plan, Zugleiste, Wischen …) → Abspielen aus
  const lineId = line?.id;
  useEffect(() => {
    setPlaying(false);
    setLead(0);
  }, [lineId]);
  useEffect(() => setHint(false), [line, step]);
  const atEndNow = !!line && step >= line.steps.length;
  useEffect(() => {
    if (on && atEndNow) buzz(25);
  }, [on, atEndNow, line?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const expected = line?.steps[step];
  const expNode = expected && tree ? tree.nodes.get(expected.key) : undefined;
  const quiz = on && selfPlay && !playing && !!expNode && turnOf(expNode.fen) === st?.color;

  // Selbst spielen: Gegnerzüge kommen von allein (kurz warten, damit man mitlesen kann)
  useEffect(() => {
    if (!on || !selfPlay || playing || !line || !expNode || !st || turnOf(expNode.fen) === st.color) return;
    const t = setTimeout(() => setLearnRaw({ line: line.id, step: step + 1 }), step === 0 ? 1000 : 650);
    return () => clearTimeout(t);
    // nur bei neuer Position neu starten (nicht bei jedem Engine-Update)
  }, [on, selfPlay, playing, line?.id, step, st?.color, !!expNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geführtes Abspielen: erst die letzten Züge vor dem Abzweig, dann die neuen Züge im eingestellten Tempo
  const checking = !!checkItem;
  useEffect(() => {
    if (!playing || !line || checking) return;
    const a = autoNext({ lead, step, len: line.steps.length });
    if (a.kind === 'stop') return setPlaying(false);
    const t = setTimeout(() => {
      if (a.kind === 'lead') setLead((l) => Math.max(0, l - 1));
      else setLearnRaw({ line: line.id, step: step + 1 });
    }, autoDelay(a, speed, step));
    return () => clearTimeout(t);
  }, [playing, lead, step, line?.id, speed, checking]); // eslint-disable-line react-hooks/exhaustive-deps

  function setLearnRaw(patch: Partial<LearnState>) {
    if (!st) return;
    update({ learn: { line: st.learn?.line ?? 'main', step: st.learn?.step ?? 0, ...st.learn, ...patch } });
  }

  if (!st || !plan || !line) return undefined;
  const lines = plan.lines;
  const setLearn = setLearnRaw;
  const history = st.learn?.back ?? [];
  /** Sprung in eine andere Linie; die aktuelle Position kommt in den Verlauf (für „Zurück“) */
  /** Jede Bedienung unterbricht das Abspielen (Stellung bleibt stehen → analysieren) */
  const halt = () => {
    setPlaying(false);
    setLead(0);
  };
  const jump = (id: string, s: number, extra: Partial<Study> = {}, learnExtra: Partial<LearnState> = {}) => {
    halt();
    const back = id === line.id ? history : [...history, { line: line.id, step }].slice(-30);
    update({ ...extra, learn: { ...st.learn, ...learnExtra, on: true, line: id, step: s, back } });
  };
  const checkOn = st.learn?.checkOn !== false;
  const checkPace: CheckPace = st.learn?.checkPace ?? 'normal';
  const threshold = CHECK_LOAD[checkPace];
  const startRun = (items: CheckItem[]) => setCheck({ items, i: 0, t0: Date.now(), phase: 'ask', right: 0, finished: false });
  /** Karte bewerten und speichern */
  const rate = (item: CheckItem, correct: boolean) => {
    const card = st.cards?.[item.key];
    // „noch einmal“ am Rundenende übt nur – der Langzeitstand hängt allein an der Erstantwort
    if (!card || item.retry) return;
    const ms = Date.now() - (check?.t0 ?? Date.now());
    const rating = ratingFor(correct, ms, srsSet);
    // ins Protokoll: Studien-Abfragen zählen für Serie und Trefferquote auf der Startseite
    void repo.addReview({ cardId: `study:${st.id}:${item.key}`, repertoireId: `study:${st.id}`, posKey: item.key, at: Date.now(), rating, correct, msToAnswer: Math.round(ms), mode: 'study' });
    update({ cards: { ...st.cards, [item.key]: { ...card, srs: scheduler.review(card.srs, rating, Date.now()) } } });
  };
  const checkNext = () =>
    setCheck((c) => (!c ? c : c.i + 1 < c.items.length ? { ...c, i: c.i + 1, phase: 'ask', t0: Date.now() } : { ...c, finished: true }));
  const goto = (i: number, s = 0) => jump(lines[i].id, s);
  const nextIdx = nextOpenLine(plan, new Set(done).add(line.id), idx);

  const undoCuts = (before: string[]) => () => update({ cuts: before });
  /** Zug entfernen (samt allem dahinter). Ganze Linie → weiter mit der nächsten offenen Linie. */
  const cutAt = (s: PathStep, whole: boolean) => {
    const before = st.cuts;
    const cuts = [...before, cutKey(s.key, s.uci)];
    if (whole) {
      update({ cuts, learn: { ...st.learn, line: nextAfterCut(s), step: 0 } });
      toast('Linie samt Untervarianten entfernt', 'ok', { label: 'Rückgängig', run: undoCuts(before) });
    } else {
      update({ cuts });
      toast('Rest der Linie entfernt', 'ok', { label: 'Rückgängig', run: undoCuts(before) });
    }
  };
  /** Nächste offene Linie, die nicht unter dem entfernten Zug hängt */
  const nextAfterCut = (cut: PathStep) => {
    for (let i = 1; i <= lines.length; i++) {
      const j = (idx + i) % lines.length;
      const l = lines[j];
      if (j === idx || done.has(l.id)) continue;
      if (l.start.some((s) => s.key === cut.key && s.uci === cut.uci)) continue;
      return l.id;
    }
    return 'main';
  };

  return {
    on,
    plan,
    idx,
    line,
    step,
    atEnd: step >= line.steps.length,
    done,
    order,
    selfPlay,
    expected,
    quiz,
    hint,
    playing,
    leading: playing && lead > 0,
    speed,
    autoStop: halt,
    autoToggle: () => {
      if (playing) return halt();
      if (check) return;
      const from = step >= line.steps.length ? 0 : step; // am Ende: noch einmal von vorn
      if (from !== step) setLearn({ line: line.id, step: 0 });
      setLead(leadFor(line.start.length, from));
      setPlaying(true);
    },
    setSpeed: (s) => setLearn({ speed: s }),
    canPrev: step > 0 || history.length > 0 || line.start.length > 0,
    nextIdx,
    setOn: (b, here) => {
      halt();
      if (b && here) {
        const o = plan.owner.get(here);
        if (o) return setLearn({ on: true, line: lines[o.line].id, step: o.step });
      }
      setLearn({ on: b });
    },
    setOrder: (o) => setLearn({ order: o }),
    setSelfPlay: (b) => {
      halt();
      setLearn({ selfPlay: b });
    },
    goto,
    next: () => {
      halt();
      if (step >= line.steps.length) return;
      if (quiz && !hint) return setHint(true); // erst den Zug zeigen (Pfeil), dann weiter
      setLearn({ line: line.id, step: step + 1 });
    },
    prev: () => {
      halt();
      if (step > 0) return setLearn({ line: line.id, step: step - 1 });
      // Linienanfang: zurück dorthin, wo man herkam (z. B. Ende der vorigen Linie) …
      const last = history[history.length - 1];
      if (last && plan.byId.has(last.line)) return setLearn({ line: last.line, step: last.step, back: history.slice(0, -1) });
      // … sonst einen Zug zurück in die Linie, von der diese abzweigt
      const before = line.start[line.start.length - 1];
      const o = before && plan.owner.get(before.key);
      if (o) setLearn({ line: lines[o.line].id, step: o.step });
    },
    markDone: () => {
      const ids = new Set(done).add(line.id);
      const n = nextOpenLine(plan, ids, idx);
      const prevDone = st.linesDone ?? [];
      const here = { line: line.id, step };
      // eigene Stellungen der Linie werden Lernkarten; abgefragt wird, sobald die Lernlast (Anzahl neuer
      // Stellungen, verwechselbare zählen mehr) den Schwellwert erreicht – Rundengröße passend zum Gelernten
      const now = Date.now();
      const cards = addLineCards(st.cards ?? {}, linePositions(tree!, line, st.color), line.id, now, inRep);
      const items = checkOn && freshLoad(cards, plan, inRep).load >= threshold ? buildRound(cards, plan, now, { skip: inRep }) : [];
      jump(n !== undefined ? lines[n].id : line.id, 0, { linesDone: [...ids], cards });
      if (items.length) startRun(items);
      // Rückgängig: Markierung entfernen und zurück ans Ende dieser Linie
      const undo = { label: 'Zurück', run: () => update({ linesDone: prevDone, learn: { ...st.learn, on: true, ...here, back: history } }) };
      // Startet gleich eine Abfrage, wäre „weiter mit Linie n“ falsch und „Zurück“ würde mitten in die Abfrage greifen
      if (items.length) toast(`Linie ${idx + 1} verstanden – erst eine kurze Abfrage`, 'ok');
      else if (n === undefined) toast('Alle Linien verstanden – Studie durchgearbeitet.', 'ok', undo);
      else toast(`Linie ${idx + 1} verstanden – weiter mit Linie ${n + 1}`, 'ok', undo);
    },
    again: () => {
      halt();
      setLearn({ line: line.id, step: 0 });
    },
    skip: () => {
      const n = nextOpenLine(plan, done, idx);
      if (n === undefined || n === idx) return toast('Keine weitere offene Linie.', 'info');
      goto(n);
    },
    cutLine: () => {
      if (line.id === 'main') return toast('Die erste Hauptlinie lässt sich nicht entfernen – einzelne Züge im Lesen-Modus.', 'info');
      cutAt(line.steps[0], true);
    },
    removeLine: (i) => {
      const l = lines[i];
      if (!l || l.id === 'main') return;
      const first = l.steps[0];
      const before = st.cuts;
      const cuts = [...before, cutKey(first.key, first.uci)];
      const hitsCurrent = i === idx || line.start.some((s) => s.key === first.key && s.uci === first.uci);
      update(hitsCurrent ? { cuts, learn: { ...st.learn, line: nextAfterCut(first), step: 0 } } : { cuts });
      toast('Linie samt Untervarianten entfernt', 'ok', { label: 'Rückgängig', run: undoCuts(before) });
    },
    cutRest: () => {
      const s = line.steps[step];
      if (!s) return;
      if (step === 0 && line.id === 'main') return toast('Die erste Hauptlinie lässt sich nicht entfernen – einzelne Züge im Lesen-Modus.', 'info');
      cutAt(s, step === 0);
    },
    check,
    checkOn,
    checkPace,
    checkLoad: { load: loadInfo.load, fresh: loadInfo.fresh.length, threshold },
    checkAvailable,
    startCheck: () => {
      halt();
      const items = buildRound(st.cards ?? {}, plan, Date.now(), { skip: inRep, manual: true });
      if (!items.length) return toast('Gerade nichts abzufragen – Karten entstehen mit „Verstanden“.', 'info');
      startRun(items);
    },
    checkMove: (uci) => {
      if (!check || check.finished) return;
      const item = check.items[check.i];
      if (check.phase === 'right') return;
      if (uci === item.uci) {
        if (check.phase === 'ask') rate(item, true);
        setCheck({ ...check, phase: 'right', right: check.right + (check.phase === 'ask' ? 1 : 0) });
        buzz(15);
        setTimeout(checkNext, check.phase === 'ask' ? 700 : 450);
        return;
      }
      if (check.phase === 'ask') {
        rate(item, false);
        buzz([40, 60, 40]);
        setCheck({ ...check, phase: 'wrong', items: requeue(check.items, item) });
      }
    },
    checkGiveUp: () => {
      if (!check || check.finished || check.phase !== 'ask') return;
      const item = check.items[check.i];
      rate(item, false);
      setCheck({ ...check, phase: 'wrong', items: requeue(check.items, item) });
    },
    checkNext,
    endCheck: () => setCheck(undefined),
    setCheckOn: (b) => setLearn({ checkOn: b }),
    setCheckPace: (pace) => setLearn({ checkPace: pace }),
    play: (uci) => {
      halt();
      if (expected && uci === expected.uci) {
        setLearn({ line: line.id, step: step + 1 });
        return true;
      }
      const at = line.steps[step]?.key ?? learnKey(tree!, learnPath);
      if (quiz && expected) {
        setHint(true); // falscher eigener Zug: Pfeil zeigt den richtigen
        toast(`Die Linie spielt hier ${sanAt(tree!, expected, 'de')}.`, 'info');
        return true;
      }
      const r = lineForMove(plan, at, uci);
      if (!r) return false;
      goto(r.line, r.step);
      return true;
    },
  };
}

/** Falsch beantwortet → einmal ans Ende der Runde (danach nicht erneut) */
function requeue(items: CheckItem[], item: CheckItem): CheckItem[] {
  return item.retry ? items : [...items, { ...item, retry: true }];
}

/** posKey am Ende eines Pfads */
function learnKey(tree: StudyTree, path: PathStep[]): string {
  let key = tree.root;
  for (const s of path) key = tree.nodes.get(s.key)?.moves.find((m) => m.uci === s.uci)?.child ?? key;
  return key;
}

/** „2…Sc6 3.Lb5 e5“ – erste Züge einer Linie mit Nummern */
export function lineLabel(tree: StudyTree, line: StudyLine, notation: 'de' | 'en', max = 4): string {
  const parts = line.steps.slice(0, max).map((s, i) => {
    const node = tree.nodes.get(s.key)!;
    const ply = plyOfFen(node.fen);
    const san = node.moves.find((m) => m.uci === s.uci)?.san ?? s.uci;
    return (i === 0 || ply % 2 === 0 ? moveNumberPrefix(ply) : '') + displaySan(san, notation);
  });
  return parts.join(' ') + (line.steps.length > max ? ' …' : '');
}

const sanAt = (tree: StudyTree, s: PathStep, notation: 'de' | 'en') => {
  const node = tree.nodes.get(s.key)!;
  return moveNumberPrefix(plyOfFen(node.fen)) + displaySan(node.moves.find((m) => m.uci === s.uci)?.san ?? s.uci, notation);
};

// ------------------------------------------------------------ Bedienleiste unter dem Brett

export function LearnControls({ learn, onTouchStart, onTouchEnd }: { learn: Learn; onTouchStart: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void }) {
  const { line, step, atEnd } = learn;
  // Am Linienende den Knopf kurz sperren: wer schnell „Weiter“ tippt, springt sonst ungewollt in die nächste Linie
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!atEnd) return setLocked(false);
    setLocked(true);
    const t = setTimeout(() => setLocked(false), 800);
    return () => clearTimeout(t);
  }, [atEnd, line.id]);
  return (
    <>
    <div className="learn-progress" role="progressbar" aria-label="Fortschritt in dieser Linie" aria-valuemin={0} aria-valuemax={line.steps.length} aria-valuenow={step}>
      {line.steps.map((_, i) => (
        <i key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
    <div className="board-controls learn-controls" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="btn icon" onClick={learn.prev} aria-label="Zug zurück" disabled={!learn.canPrev}>
        <Icon name="prev" />
      </button>
      {atEnd && learn.playing ? null : atEnd ? (
        <button className="btn primary learn-go done" onClick={learn.markDone} disabled={locked}>
          <Icon name="check" /> Verstanden
        </button>
      ) : (
        <button className="btn primary learn-go" onClick={learn.next}>
          {learn.quiz ? (learn.hint ? 'Zug spielen' : 'Zeigen') : 'Weiter'} <Icon name="next" />
        </button>
      )}
      <button
        className={`btn icon learn-auto ${learn.playing ? 'on' : ''}`}
        onClick={learn.autoToggle}
        aria-pressed={learn.playing}
        aria-label={learn.playing ? 'Abspielen anhalten' : atEnd ? 'Linie noch einmal abspielen' : 'Linie abspielen'}
        title={learn.playing ? 'Anhalten – du kannst die Stellung in Ruhe ansehen und analysieren' : 'Die neuen Züge der Linie laufen von allein ab (Tempo einstellbar)'}
        data-testid="learn-auto"
      >
        <Icon name={learn.playing ? 'pause' : 'play'} />
      </button>
      {learn.playing && (
        <button
          className="btn small ghost learn-speed"
          onClick={() => learn.setSpeed(AUTO_SPEEDS[(AUTO_SPEEDS.findIndex((s) => s.id === learn.speed) + 1) % AUTO_SPEEDS.length].id)}
          title="Tempo wechseln"
        >
          {AUTO_SPEEDS.find((s) => s.id === learn.speed)?.label}
        </button>
      )}
      {/* Abschneiden steht bewusst nur im „…“-Menü der Linienkarte – neben „Weiter“ wurde es zu leicht versehentlich getroffen */}
      <span className="learn-count" title="Züge dieser Linie">
        {step}/{line.steps.length}
      </span>
    </div>
    </>
  );
}

// ------------------------------------------------------------ Zwischenabfrage

export function CheckPanel({ learn, tree, notation }: { learn: Learn; tree: StudyTree; notation: 'de' | 'en' }) {
  const c = learn.check!;
  const item = c.items[c.i];
  const n = c.items.length;
  const correctSan = item ? sanAt(tree, { key: item.key, uci: item.uci }, notation) : '';
  return (
    <>
      <div className="learn-progress check" aria-hidden>
        {c.items.map((_, i) => (
          <i key={i} className={i < c.i || c.finished ? 'on' : ''} />
        ))}
      </div>
      <div className={`learn-card check-card ${c.finished ? 'finished' : c.phase}`} role="status">
        <div className="learn-meta">
          <span className="tag lvl0">Abfrage</span>
          <span className="learn-of">
            {c.finished ? `${n} Abfragen` : `${c.i + 1}/${n}${item?.retry ? ' · noch einmal' : item?.fresh ? ' · neu gelernt' : ' · Wiederholung'}`}
          </span>
          {!c.finished && (
            <button className="btn small ghost check-end" onClick={learn.endCheck}>
              Beenden
            </button>
          )}
        </div>
        {c.finished ? (
          <>
            <p className="check-big ok">
              <Icon name="check" /> {c.right} von {n} richtig
            </p>
            <p className="hint">Falsche Stellungen kommen bald wieder, sichere seltener. Beim Übernehmen ins Repertoire geht dieser Lernstand mit.</p>
            <button className="btn primary learn-go" onClick={learn.endCheck}>
              Weiter lernen <Icon name="next" />
            </button>
          </>
        ) : c.phase === 'ask' ? (
          <>
            <p className="check-big">Dein Zug?</p>
            <p className="hint">Spiel den Zug aus der Studie am Brett.</p>
            <button className="btn" onClick={learn.checkGiveUp}>
              Weiß ich nicht
            </button>
          </>
        ) : c.phase === 'wrong' ? (
          <>
            <p className="check-big bad">
              <Icon name="x" /> Richtig ist {correctSan}
            </p>
            <p className="hint">Spiel ihn nach – die Stellung kommt bald wieder.</p>
            <button className="btn" onClick={learn.checkNext}>
              Weiter <Icon name="next" />
            </button>
          </>
        ) : (
          <p className="check-big ok">
            <Icon name="check" /> Richtig
          </p>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------ Linienkarte (Abzweig, Ende, Abweichen)

export function LearnCard({
  learn,
  tree,
  view,
  fen,
  notation,
  st,
  onChoose,
  comment,
  onAdd,
}: {
  learn: Learn;
  tree: StudyTree;
  view: NodeView;
  fen: string;
  notation: 'de' | 'en';
  st: Study;
  /** anderen eigenen Zug der Studie an dieser Stellung wählen */
  onChoose: (uci: string) => void;
  /** Kommentar der Studie zum letzten Zug – steht ganz oben, direkt unter den Knöpfen */
  comment?: ReactNode;
  /** Linie ins Repertoire übernehmen (öffnet den Übernahme-Dialog) */
  onAdd?: () => void;
}) {
  const { line, idx, step, atEnd, plan, done } = learn;
  const total = plan.lines.length;
  const first = line.steps[0];
  // Abzweig: was die Linie, zu der die Stellung gehört, hier stattdessen spielt
  const owner = plan.owner.get(first.key);
  const mainHere = owner ? plan.lines[owner.line].steps[owner.step] : undefined;
  const who = turnOf(tree.nodes.get(first.key)!.fen) === st.color ? 'du' : 'der Gegner';
  // Abweichen: andere Studienzüge an dieser Stellung, die zu einer Linie gehören
  const alts = view.moves.filter((m) => m.status !== 'cut' && m.status !== 'alt' && m.uci !== learn.expected?.uci);
  // Eigene Alternativen der Studie (nicht gewählt) – sonst fielen z. B. ganze Kapitel unbemerkt aus dem Plan
  const ownAlts = view.moves.filter((m) => m.status === 'alt');
  const label = (san: string) => moveNumberPrefix(plyOfFen(fen)) + displaySan(san, notation);
  const repDiff = atEnd && view.mine && view.repMove && view.moves.some((m) => m.status !== 'cut') && !view.moves.some((m) => m.inRep);
  return (
    <div className="learn-card">
      {comment}
      {step === 0 && (
        <p className="learn-text">
          {idx === 0 || !mainHere ? (
            <>Hauptlinie der Studie – einmal ganz durchgehen.</>
          ) : (
            <>
              Abzweig: Statt <b>{sanAt(tree, mainHere, notation)}</b> spielt {who} hier <b className={who === 'du' ? 'me' : 'warn'}>{sanAt(tree, first, notation)}</b>.
            </>
          )}
        </p>
      )}
      {atEnd && (
        <div className="learn-end" role="status">
          <b className="learn-end-title">
            <Icon name="check" /> Ende der Linie
          </b>{' '}
          {line.transposeTo ? (
            <span>
              Zugumstellung: Diese Stellung kennst du aus Linie {line.transposeTo.line + 1}
              {!done.has(plan.lines[line.transposeTo.line].id) && ' (dort noch nicht verstanden)'}.
            </span>
          ) : repDiff ? (
            <span className="warn">Dein Repertoire spielt hier {displaySan(view.repMove!.san, notation)} – die Studie geht anders weiter.</span>
          ) : null}
          {learn.nextIdx !== undefined && <p className="learn-next">Als Nächstes: {lineLabel(tree, plan.lines[learn.nextIdx], notation, 3)}</p>}
          <div className="row-actions">
            <button className="btn small" onClick={learn.again}>
              <Icon name="undo" /> Nochmal
            </button>
            {onAdd && (
              <button className="btn small" onClick={onAdd}>
                <Icon name="plus" /> Linie ins Repertoire
              </button>
            )}
            <button className="btn small ghost" onClick={learn.skip}>
              Überspringen
            </button>
          </div>
        </div>
      )}
      {alts.length > 0 && (
        <div className="learn-alts">
          <small>{atEnd ? 'Weiter mit' : 'Abweichen'}</small>
          {alts.map((m) => (
            <button key={m.uci} className={`var-chip ${m.status}`} onClick={() => learn.play(m.uci)} title={m.comment}>
              {label(m.san)}
            </button>
          ))}
        </div>
      )}
      {ownAlts.length > 0 && (
        <div className="learn-alts own">
          <small>Studie hat hier auch (nicht gewählt)</small>
          {ownAlts.map((m) => (
            <button
              key={m.uci}
              className="var-chip alt"
              onClick={() =>
                toast(`${label(m.san)} als deinen Zug wählen? Dann lernst du diesen Ast statt des bisherigen.`, 'info', {
                  label: 'Wählen',
                  run: () => onChoose(m.uci),
                })
              }
            >
              {label(m.san)}
            </button>
          ))}
        </div>
      )}
      {/* Linien-Info klein am Ende – wo genau man ist, muss nicht ständig im Blick sein (Details im Plan) */}
      <div className="learn-meta">
        <span className={`tag lvl lvl${Math.min(line.level, 3)}`}>{levelName(line.level)}</span>
        <span className="learn-of">
          Linie {idx + 1}/{total}
        </span>
        {done.has(line.id) && <span className="tag ok">verstanden</span>}
        {learn.checkAvailable > 0 && (
          <button className="btn small check-chip" onClick={learn.startCheck} title="Gelernte Stellungen abfragen">
            Abfrage ({learn.checkAvailable})
          </button>
        )}
        <RowMenu label="Aktionen für diese Linie">
          {!atEnd && <button onClick={learn.cutRest}>{step === 0 ? 'Diese Linie nicht lernen (entfernen)' : 'Ab hier nicht interessant (Rest entfernen)'}</button>}
          <button onClick={learn.skip}>Linie überspringen (später)</button>
          <button onClick={learn.again}>Von vorn</button>
          {onAdd && <button onClick={onAdd}>Ins Repertoire übernehmen …</button>}
          <button className="danger" disabled={line.id === 'main'} onClick={learn.cutLine}>
            Ganze Linie entfernen …
          </button>
        </RowMenu>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Plan (Fortschrittskarte, Reihenfolge, Linienliste)

const LEVEL_PLURAL = ['Hauptlinien', 'Nebenlinien', 'Untervarianten', 'Details'];

export function LearnPlan({ learn, tree, notation }: { learn: Learn; tree: StudyTree; notation: 'de' | 'en' }) {
  const { plan, idx, done } = learn;
  const [limit, setLimit] = useState(30);
  const stats = useMemo(() => {
    const levels: { total: number; done: number }[] = [];
    // Kapitel in Reihenfolge ihres ersten Auftretens im Plan
    const chapters = new Map<number, { idxs: number[]; done: number; open: number }>();
    let doneCount = 0;
    let openMoves = 0;
    plan.lines.forEach((l, i) => {
      const k = Math.min(l.level, 3);
      levels[k] ??= { total: 0, done: 0 };
      levels[k].total++;
      const d = done.has(l.id);
      if (d) {
        levels[k].done++;
        doneCount++;
      } else openMoves += l.steps.length;
      const g = chapters.get(l.chapter) ?? { idxs: [], done: 0, open: 0 };
      g.idxs.push(i);
      if (d) g.done++;
      else g.open++;
      chapters.set(l.chapter, g);
    });
    return { levels, chapters: [...chapters.entries()], doneCount, openMoves };
  }, [plan, done]);
  const pct = plan.lines.length ? Math.round((100 * stats.doneCount) / plan.lines.length) : 0;
  const curChapter = plan.lines[idx]?.chapter;
  const from = Math.max(0, idx - 3);
  const rows = plan.lines.slice(from, from + limit);
  return (
    <div className="learn-plan">
      <div className="learn-total">
        <b>{pct} %</b>
        <span>
          {stats.doneCount} von {plan.lines.length} Linien verstanden
          <small>noch {stats.openMoves} Züge in offenen Linien</small>
        </span>
      </div>
      <div className="learn-totalbar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="lvl-rows">
        {stats.levels.map((v, k) =>
          v ? (
            <div key={k} className="lvl-row">
              <span>{LEVEL_PLURAL[k]}</span>
              <span className="kbar">
                <i style={{ flex: v.done, background: 'var(--me)' }} />
                <i style={{ flex: v.total - v.done, background: 'transparent' }} />
              </span>
              <small>
                {v.done}/{v.total}
              </small>
            </div>
          ) : null,
        )}
      </div>

      <h3 className="learn-h">Fortschritt nach Kapitel</h3>
      <p className="hint learn-legend">
        <i className="lmap-cell done" /> verstanden <i className="lmap-cell lvl0" /> Hauptlinie offen <i className="lmap-cell" /> offen <i className="lmap-cell cur" /> aktuell
      </p>
      <div className="lmap">
        {stats.chapters.map(([ch, g]) => (
          <details key={ch} className="lmap-group" open={ch === curChapter || stats.chapters.length <= 4}>
            <summary>
              <span className="lmap-name">{tree.chapters[ch]?.name ?? `Kapitel ${ch + 1}`}</span>
              <span className="lmap-bar">
                <i style={{ width: `${(100 * g.done) / g.idxs.length}%` }} />
              </span>
              <small>
                {g.done}/{g.idxs.length}
              </small>
            </summary>
            <div className="lmap-cells">
              {g.idxs.map((i) => {
                const l = plan.lines[i];
                return (
                  <button
                    key={l.id}
                    className={`lmap-cell lvl${Math.min(l.level, 3)} ${done.has(l.id) ? 'done' : ''} ${i === idx ? 'cur' : ''}`}
                    title={`Linie ${i + 1}: ${lineLabel(tree, l, notation)}`}
                    aria-label={`Linie ${i + 1}: ${lineLabel(tree, l, notation)}${done.has(l.id) ? ', verstanden' : ''}`}
                    onClick={() => learn.goto(i)}
                  />
                );
              })}
            </div>
            {g.open > 0 && !g.idxs.includes(idx) && (
              <button className="btn small ghost" onClick={() => learn.goto(g.idxs.find((i) => !done.has(plan.lines[i].id))!)}>
                Mit diesem Kapitel weitermachen
              </button>
            )}
          </details>
        ))}
      </div>

      <h3 className="learn-h">Einstellungen</h3>
      <div className="learn-opts">
        <div className="seg small" role="group" aria-label="Reihenfolge">
          <button aria-pressed={learn.order === 'skeleton'} onClick={() => learn.setOrder('skeleton')} title="Erst alle Hauptlinien, dann Nebenlinien, dann Details">
            Gerüst zuerst
          </button>
          <button aria-pressed={learn.order === 'study'} onClick={() => learn.setOrder('study')} title="Reihenfolge der Studie: jede Variante samt Untervarianten am Stück">
            Wie in der Studie
          </button>
        </div>
        <label className="field inline">
          <span>Abspiel-Tempo</span>
          <select value={learn.speed} onChange={(e) => learn.setSpeed(e.target.value as AutoSpeed)} aria-label="Abspiel-Tempo">
            {AUTO_SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({(s.ms / 1000).toFixed(1).replace('.', ',')} s pro Zug)
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={learn.selfPlay} onChange={(e) => learn.setSelfPlay(e.target.checked)} /> Eigene Züge selbst spielen
        </label>
        <label className="check">
          <input type="checkbox" checked={learn.checkOn} onChange={(e) => learn.setCheckOn(e.target.checked)} /> Zwischendurch abfragen
        </label>
        {learn.checkOn && (
          <label className="field inline">
            <span>Takt</span>
            <select value={learn.checkPace} onChange={(e) => learn.setCheckPace(e.target.value as CheckPace)} aria-label="Abfrage-Takt">
              <option value="often">häufig (ab ca. {CHECK_LOAD.often} neuen Stellungen)</option>
              <option value="normal">normal (ab ca. {CHECK_LOAD.normal})</option>
              <option value="rare">selten (ab ca. {CHECK_LOAD.rare})</option>
            </select>
          </label>
        )}
        {learn.checkOn && (
          <p className="hint learn-loadinfo">
            Seit der letzten Abfrage neu gelernt: <b>{learn.checkLoad.fresh}</b> {learn.checkLoad.fresh === 1 ? 'Stellung' : 'Stellungen'}
            {learn.checkLoad.load > learn.checkLoad.fresh && ' (teils leicht verwechselbar – zählen mehr)'}. Abfrage ab Lernlast {learn.checkLoad.threshold}, gerade{' '}
            {Math.round(learn.checkLoad.load * 10) / 10}.
          </p>
        )}
        <button className="btn small" onClick={learn.startCheck} disabled={!learn.checkAvailable}>
          Jetzt abfragen ({learn.checkAvailable})
        </button>
      </div>

      <h3 className="learn-h">Nächste Linien</h3>
      <ol className="line-list">
        {rows.map((l, k) => {
          const i = from + k;
          return (
            <li key={l.id} className="line-item">
              <button className={`line-row ${i === idx ? 'cur' : ''} ${done.has(l.id) ? 'done' : ''}`} onClick={() => learn.goto(i)}>
                <span className="ln">{done.has(l.id) ? <Icon name="check" /> : i + 1}</span>
                <span className="lt">
                  <b>{lineLabel(tree, l, notation)}</b>
                  <small>
                    {levelName(l.level)} · {tree.chapters[l.chapter]?.name ?? ''} · {l.steps.length} Züge{l.transposeTo ? ' · Zugumstellung' : ''}
                  </small>
                </span>
              </button>
              {l.id !== 'main' && (
                <button className="btn small ghost line-cut" aria-label={`Linie ${i + 1} nicht lernen (entfernen)`} title="Linie samt Untervarianten entfernen" onClick={() => learn.removeLine(i)}>
                  <Icon name="scissors" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {from + limit < plan.lines.length && (
        <button className="btn small ghost" onClick={() => setLimit((x) => x + 50)}>
          Weitere {Math.min(50, plan.lines.length - from - limit)} anzeigen
        </button>
      )}
    </div>
  );
}
