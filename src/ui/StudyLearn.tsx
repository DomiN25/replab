// Lernmodus der Studien: geführt Linie für Linie durch die Studie (Algorithmus in core/studyLines.ts).
// Zustand liegt in der Studie (learn, linesDone) und wird mit ihr gespeichert und synchronisiert.
// Die Studienansicht (Studies.tsx) zeichnet Brett und Zugleiste; dieser Baustein liefert Zustand, Aktionen,
// die Bedienleiste unter dem Brett, die Linienkarte und den Plan.
import { useEffect, useMemo, useState } from 'react';
import { displaySan, moveNumberPrefix, plyOfFen, turnOf } from '../core/chess';
import { cutKey, type ExistingEntry, type StudyTree } from '../core/pgn';
import type { NodeView, PathStep } from '../core/study';
import { buildLinePlan, levelName, lineForMove, nextOpenLine, type LineOrder, type LinePlan, type StudyLine } from '../core/studyLines';
import type { Study } from '../core/types';
import { Icon } from './Icon';
import { RowMenu } from './RowMenu';
import { toast } from './store';

type LearnState = NonNullable<Study['learn']>;

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
  hint: boolean;
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
  /** Zug am Brett/aus der Leiste; liefert false, wenn der Zug zu keiner Linie gehört */
  play: (uci: string) => boolean;
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

  let idx = -1;
  let step = 0;
  if (plan?.lines.length) {
    idx = plan.byId.get(st?.learn?.line ?? 'main') ?? nextOpenLine(plan, done, -1) ?? 0;
    step = Math.min(Math.max(0, st?.learn?.step ?? 0), plan.lines[idx].steps.length);
  }
  const line = idx >= 0 ? plan!.lines[idx] : undefined;
  const learnPath = useMemo(() => (line ? [...line.start, ...line.steps.slice(0, step)] : []), [line, step]);
  // Brett folgt der Lernposition
  useEffect(() => {
    if (on && line) setPath(learnPath);
  }, [on, learnPath]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setHint(false), [line, step]);

  const expected = line?.steps[step];
  const expNode = expected && tree ? tree.nodes.get(expected.key) : undefined;
  const quiz = on && selfPlay && !!expNode && turnOf(expNode.fen) === st?.color;

  // Selbst spielen: Gegnerzüge kommen von allein (kurz warten, damit man mitlesen kann)
  useEffect(() => {
    if (!on || !selfPlay || !line || !expNode || !st || turnOf(expNode.fen) === st.color) return;
    const t = setTimeout(() => setLearnRaw({ line: line.id, step: step + 1 }), step === 0 ? 1000 : 650);
    return () => clearTimeout(t);
    // nur bei neuer Position neu starten (nicht bei jedem Engine-Update)
  }, [on, selfPlay, line?.id, step, st?.color, !!expNode]); // eslint-disable-line react-hooks/exhaustive-deps

  function setLearnRaw(patch: Partial<LearnState>) {
    if (!st) return;
    update({ learn: { line: st.learn?.line ?? 'main', step: st.learn?.step ?? 0, ...st.learn, ...patch } });
  }

  if (!st || !plan || !line) return undefined;
  const lines = plan.lines;
  const setLearn = setLearnRaw;
  const goto = (i: number, s = 0) => setLearn({ line: lines[i].id, step: s, on: true });

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
    setOn: (b, here) => {
      if (b && here) {
        const o = plan.owner.get(here);
        if (o) return setLearn({ on: true, line: lines[o.line].id, step: o.step });
      }
      setLearn({ on: b });
    },
    setOrder: (o) => setLearn({ order: o }),
    setSelfPlay: (b) => setLearn({ selfPlay: b }),
    goto,
    next: () => {
      if (step >= line.steps.length) return;
      if (quiz && !hint) return setHint(true); // erst den Zug zeigen (Pfeil), dann weiter
      setLearn({ line: line.id, step: step + 1 });
    },
    prev: () => step > 0 && setLearn({ line: line.id, step: step - 1 }),
    markDone: () => {
      const ids = new Set(done).add(line.id);
      const n = nextOpenLine(plan, ids, idx);
      update({ linesDone: [...ids], learn: { ...st.learn, line: n !== undefined ? lines[n].id : line.id, step: 0 } });
      if (n === undefined) toast('Alle Linien verstanden – Studie durchgearbeitet.', 'ok');
    },
    again: () => setLearn({ line: line.id, step: 0 }),
    skip: () => {
      const n = nextOpenLine(plan, done, idx);
      if (n === undefined || n === idx) return toast('Keine weitere offene Linie.', 'info');
      goto(n);
    },
    cutLine: () => {
      if (line.id === 'main') return toast('Die erste Hauptlinie lässt sich nicht entfernen – einzelne Züge im Lesen-Modus.', 'info');
      cutAt(line.steps[0], true);
    },
    cutRest: () => {
      const s = line.steps[step];
      if (!s) return;
      if (step === 0 && line.id === 'main') return toast('Die erste Hauptlinie lässt sich nicht entfernen – einzelne Züge im Lesen-Modus.', 'info');
      cutAt(s, step === 0);
    },
    play: (uci) => {
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
  return (
    <div className="board-controls learn-controls" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="btn icon" onClick={learn.prev} aria-label="Zug zurück" disabled={step === 0}>
        <Icon name="prev" />
      </button>
      {atEnd ? (
        <button className="btn primary learn-go" onClick={learn.markDone}>
          <Icon name="check" /> Verstanden
        </button>
      ) : (
        <button className="btn primary learn-go" onClick={learn.next}>
          {learn.quiz ? (learn.hint ? 'Zug spielen' : 'Zeigen') : 'Weiter'} <Icon name="next" />
        </button>
      )}
      <span className="learn-count" title="Züge dieser Linie">
        {step}/{line.steps.length}
      </span>
    </div>
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
}: {
  learn: Learn;
  tree: StudyTree;
  view: NodeView;
  fen: string;
  notation: 'de' | 'en';
  st: Study;
  /** anderen eigenen Zug der Studie an dieser Stellung wählen */
  onChoose: (uci: string) => void;
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
      <div className="learn-meta">
        <span className={`tag lvl lvl${Math.min(line.level, 3)}`}>{levelName(line.level)}</span>
        <span className="learn-of">
          Linie {idx + 1} von {total}
        </span>
        {done.has(line.id) && <span className="tag ok">verstanden</span>}
        <RowMenu label="Aktionen für diese Linie">
          {!atEnd && <button onClick={learn.cutRest}>{step === 0 ? 'Diese Linie nicht lernen (entfernen)' : 'Ab hier nicht interessant (Rest entfernen)'}</button>}
          <button onClick={learn.skip}>Linie überspringen (später)</button>
          <button onClick={learn.again}>Von vorn</button>
          <button className="danger" disabled={line.id === 'main'} onClick={learn.cutLine}>
            Ganze Linie entfernen …
          </button>
        </RowMenu>
      </div>
      {step === 0 && (
        <p className="learn-text">
          {idx === 0 || !mainHere ? (
            <>Hauptlinie der Studie – einmal ganz durchgehen.</>
          ) : (
            <>
              Abzweig: Statt <b>{sanAt(tree, mainHere, notation)}</b> spielt {who} hier <b className={who === 'du' ? 'me' : 'warn'}>{sanAt(tree, first, notation)}</b>.
            </>
          )}{' '}
          <span className="hint">
            {line.steps.length} Züge{line.comments ? ` · ${line.comments} Kommentare` : ''}
          </span>
        </p>
      )}
      {atEnd && (
        <div className="learn-end" role="status">
          <b>Ende der Linie.</b>{' '}
          {line.transposeTo ? (
            <span>
              Zugumstellung: Diese Stellung kennst du aus Linie {line.transposeTo.line + 1} ({levelName(plan.lines[line.transposeTo.line].level)})
              {!done.has(plan.lines[line.transposeTo.line].id) && ' – dort noch nicht verstanden'}.
            </span>
          ) : repDiff ? (
            <span className="warn">Dein Repertoire spielt hier {displaySan(view.repMove!.san, notation)} – die Studie geht anders weiter.</span>
          ) : null}
          <div className="row-actions">
            <button className="btn small" onClick={learn.again}>
              <Icon name="undo" /> Nochmal
            </button>
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
    </div>
  );
}

// ------------------------------------------------------------ Plan (Reihenfolge, Fortschritt, Linienliste)

const LEVEL_PLURAL = ['Hauptlinien', 'Nebenlinien', 'Untervarianten', 'Details'];

export function LearnPlan({ learn, tree, notation }: { learn: Learn; tree: StudyTree; notation: 'de' | 'en' }) {
  const { plan, idx, done } = learn;
  const [limit, setLimit] = useState(30);
  // Fortschritt je Ebene (Details ab Ebene 3 zusammengefasst)
  const levels = useMemo(() => {
    const out: { total: number; done: number }[] = [];
    for (const l of plan.lines) {
      const k = Math.min(l.level, 3);
      out[k] ??= { total: 0, done: 0 };
      out[k].total++;
      if (done.has(l.id)) out[k].done++;
    }
    return out;
  }, [plan, done]);
  const doneCount = plan.lines.filter((l) => done.has(l.id)).length;
  const from = Math.max(0, idx - 3);
  const rows = plan.lines.slice(from, from + limit);
  return (
    <div className="learn-plan">
      <p className="learn-sum">
        <b>{doneCount}</b> von {plan.lines.length} Linien verstanden
      </p>
      <div className="lvl-rows">
        {levels.map((v, k) =>
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
      <div className="learn-opts">
        <div className="seg small" role="group" aria-label="Reihenfolge">
          <button aria-pressed={learn.order === 'skeleton'} onClick={() => learn.setOrder('skeleton')} title="Erst alle Hauptlinien, dann Nebenlinien, dann Details">
            Gerüst zuerst
          </button>
          <button aria-pressed={learn.order === 'study'} onClick={() => learn.setOrder('study')} title="Reihenfolge der Studie: jede Variante samt Untervarianten am Stück">
            Wie in der Studie
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={learn.selfPlay} onChange={(e) => learn.setSelfPlay(e.target.checked)} /> Eigene Züge selbst spielen
        </label>
      </div>
      <ol className="line-list">
        {rows.map((l, k) => {
          const i = from + k;
          return (
            <li key={l.id}>
              <button className={`line-row ${i === idx ? 'cur' : ''} ${done.has(l.id) ? 'done' : ''}`} onClick={() => learn.goto(i)}>
                <span className="ln">{done.has(l.id) ? <Icon name="check" /> : i + 1}</span>
                <span className="lt">
                  <b>{lineLabel(tree, l, notation)}</b>
                  <small>
                    {levelName(l.level)} · {l.steps.length} Züge{l.transposeTo ? ' · Zugumstellung' : ''}
                  </small>
                </span>
              </button>
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
