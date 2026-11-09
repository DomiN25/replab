// Studien-Reiter: Studien ablegen, ansehen, zuschneiden (Äste entfernen, Züge wählen, Kapitel abwählen)
// und erst dann ins Repertoire übernehmen. Das Original-PGN bleibt unverändert; Bearbeitungen liegen daneben.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { DrawShape } from 'chessground/draw';
import { Board, uciSquares } from './Board';
import { BottomSheet, type SheetSnap } from './BottomSheet';
import { Icon } from './Icon';
import { Modal, trapFocus } from './Modal';
import { useBackClose } from './backClose';
import { useEngine, useMediaQuery } from './hooks';
import { EvalBar } from './EvalBar';
import { LearnCard, LearnControls, LearnPlan, useLearn } from './StudyLearn';
import { lichessToken, lineFromUcis, loadRepData, reloadRepertoires, selectRepertoire, setLine, setView, toast, useApp } from './store';
import { repo } from '../data/repo';
import { buildStudyTree, cutKey, guessColor, pgnOrientation, planImport, studyStart, type ExistingEntry } from '../core/pgn';
import { activeChapters, chapterEntry, firstExcluded, keysFrom, nextUnseen, nodeView, readingOrder, skipNotChosen, studyFilter, subtreeSize, type PathStep } from '../core/study';
import type { ImportPlan } from '../core/pgn';
import { displaySan, moveNumberPrefix, plyOfFen } from '../core/chess';
import { fetchStudyPgn, parseStudyUrl, studyName } from '../services/lichessStudy';
import type { Color, Study } from '../core/types';

/** PGN als Studie ablegen und im Studien-Reiter öffnen (auch aus dem Import-Dialog). */
export async function saveAsStudy(pgn: string, name: string, source?: string, color?: Color): Promise<void> {
  const c = color ?? pgnOrientation(pgn) ?? guessColor(pgn) ?? 'white';
  const st = await repo.createStudy({ name: name || studyName(pgn) || 'Studie', color: c, pgn, source });
  useApp.setState({ studyId: st.id });
  setView('studies');
  toast(`Studie „${st.name}“ gespeichert – jetzt ansehen und zuschneiden`, 'ok');
}

export function Studies() {
  const studyId = useApp((s) => s.studyId);
  return studyId ? <StudyEditor key={studyId} id={studyId} /> : <StudyList />;
}

// ------------------------------------------------------------ Liste

function StudyList() {
  const repertoires = useApp((s) => s.repertoires);
  const [list, setList] = useState<Study[] | undefined>();
  const [adding, setAdding] = useState(() => {
    const want = !!useApp.getState().studyAdd;
    if (want) useApp.setState({ studyAdd: false });
    return want;
  });
  const [del, setDel] = useState<Study | undefined>();
  const reload = () => void repo.listStudies().then(setList);
  useEffect(reload, []);

  return (
    <div className="page studies">
      <header className="page-head">
        <h1>Studien</h1>
        {!!list?.length && (
          <div className="tools">
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Studie hinzufügen
            </button>
          </div>
        )}
      </header>
      <p className="page-lead">Studien ansehen, zuschneiden und erst dann ins Repertoire übernehmen.</p>
      <details className="explain">
        <summary>
          <Icon name="info" /> Wie funktionieren Studien?
        </summary>
        <p>
          Hier liegen Studien, bevor sie ins Repertoire kommen: ansehen, nicht gewünschte Äste entfernen, bei mehreren eigenen Zügen einen wählen – und erst dann
          übernehmen. Nur die übernommenen Stellungen werden Lernkarten. Studien samt Bearbeitung und Fortschritt sind in der JSON-Sicherung und – wenn verbunden – im
          Google-Drive-Sync.
        </p>
      </details>
      {list === undefined ? null : list.length === 0 ? (
        <div className="empty card empty-cta">
          <Icon name="book" />
          <p>Noch keine Studie. Füge eine per Lichess-Link, Datei oder eingefügtem PGN hinzu – du kannst sie erst ansehen und zuschneiden.</p>
          <button className="btn primary big" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Studie hinzufügen
          </button>
        </div>
      ) : (
        <ul className="study-list">
          {list.map((st) => {
            const chapters = (st.pgn.match(/^\[Event /gm) ?? []).length;
            const last = st.added?.[st.added.length - 1];
            const repName = last && repertoires.find((r) => r.id === last.repertoireId)?.name;
            return (
              <li key={st.id} className="card study-item">
                <button className="study-open" onClick={() => useApp.setState({ studyId: st.id })}>
                  <span className={`kdot ${st.color}`} aria-hidden />
                  <span className="study-meta">
                    <b>{st.name}</b>
                    <small>
                      {st.color === 'white' ? 'Weiß' : 'Schwarz'} · {chapters} {chapters === 1 ? 'Kapitel' : 'Kapitel'}
                      {st.cuts.length > 0 && ` · ${st.cuts.length} Äste entfernt`}
                      {last && ` · übernommen in „${repName ?? 'Repertoire'}“ (+${last.entries})`}
                    </small>
                  </span>
                  <Icon name="next" />
                </button>
                <button className="btn small ghost danger" aria-label={`${st.name} löschen`} onClick={() => setDel(st)}>
                  <Icon name="trash" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && <StudyAddDialog onClose={() => setAdding(false)} />}
      {del && (
        <Modal
          title={`Studie „${del.name}“ löschen?`}
          onClose={() => setDel(undefined)}
          actions={[
            {
              label: 'Löschen',
              kind: 'danger',
              onClick: () => {
                void repo.deleteStudy(del.id).then(reload);
                setDel(undefined);
              },
            },
            { label: 'Abbrechen', kind: 'ghost', onClick: () => setDel(undefined) },
          ]}
        >
          <p>Die Studie und deine Bearbeitungen werden gelöscht. Was du schon ins Repertoire übernommen hast, bleibt dort.</p>
        </Modal>
      )}
    </div>
  );
}

function StudyAddDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [color, setColor] = useState<Color | ''>('');
  const [busy, setBusy] = useState(false);
  const ref = parseStudyUrl(url);
  useBackClose(true, onClose);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') trapFocus(e, box.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const detected = useMemo(() => (text.trim() ? pgnOrientation(text) ?? guessColor(text) : undefined), [text]);

  const load = async () => {
    if (!ref) return;
    setBusy(true);
    try {
      const pgn = await fetchStudyPgn(ref, lichessToken() || undefined);
      setText(pgn);
      setName(studyName(pgn) ?? 'Lichess-Studie');
      setSource(url.trim());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Studie hinzufügen" ref={box} onClick={(e) => e.stopPropagation()}>
        <h2>Studie hinzufügen</h2>
        <div className="field">
          <span>Lichess-Studie (Link)</span>
          <div className="row-actions" style={{ margin: 0 }}>
            <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://lichess.org/study/…" aria-label="Lichess-Studienlink" />
            <button className="btn" disabled={!ref || busy} onClick={() => void load()}>
              {busy ? 'Lädt …' : 'Laden'}
            </button>
          </div>
        </div>
        <label className="field">
          <span>oder Datei</span>
          <input
            type="file"
            accept=".pgn,.txt,application/x-chess-pgn,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setText(await f.text());
              setName(f.name.replace(/\.pgn$/i, ''));
              setSource(undefined);
            }}
          />
        </label>
        <label className="field">
          <span>oder PGN einfügen</span>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="[Event &quot;…&quot;] 1. e4 c5 …" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Anti-Sizilianer" />
          </label>
          <label className="field">
            <span>
              Für {detected && !color && <small>(erkannt: {detected === 'white' ? 'Weiß' : 'Schwarz'})</small>}
              {!detected && !color && text.trim() && <small className="warn"> (nicht erkannt – bitte prüfen)</small>}
            </span>
            <select value={color || detected || 'white'} onChange={(e) => setColor(e.target.value as Color)}>
              <option value="white">Weiß</option>
              <option value="black">Schwarz</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => {
              void saveAsStudy(text, name, source, (color || detected || 'white') as Color);
              onClose();
            }}
          >
            Als Studie speichern
          </button>
          <button className="btn ghost" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Editor

function StudyEditor({ id }: { id: string }) {
  const repertoires = useApp((s) => s.repertoires);
  const notation = useApp((s) => s.settings.ui.notation);
  const mobile = useMediaQuery('(max-width: 899px)');
  const [st, setSt] = useState<Study | undefined>();
  const [path, setPath] = useState<PathStep[]>([]);
  const [tab, setTab] = useState<'moves' | 'chapters'>('moves');
  const [snap, setSnap] = useState<SheetSnap>('min'); // Studien lesen: Brett, Varianten und Text frei
  const [targetId, setTargetId] = useState<string | undefined>();
  const [existing, setExisting] = useState<Map<string, ExistingEntry>>(new Map());
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const boardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void repo.getStudy(id).then((s) => {
      if (!s) useApp.setState({ studyId: undefined });
      else {
        setSt(s);
        setPath(s.lastPath ?? []);
      }
    });
  }, [id]);

  // Speichern gebündelt (die Studie enthält das ganze PGN): kurz nach der letzten Änderung, beim Verlassen sofort
  const latest = useRef<Study | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = (n: Study) => {
    latest.current = n;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void repo.saveStudy(n);
    }, 500);
  };
  useEffect(() => {
    const flush = () => {
      if (timer.current && latest.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
        void repo.saveStudy(latest.current);
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, []);

  // Ziel-Repertoire: Hauptrepertoire der Studienfarbe, sonst irgendeins dieser Farbe
  useEffect(() => {
    if (!st || targetId) return;
    const r = repertoires.find((x) => x.color === st.color && x.isMain) ?? repertoires.find((x) => x.color === st.color);
    if (r) setTargetId(r.id);
  }, [st, repertoires, targetId]);
  useEffect(() => {
    if (!targetId) return setExisting(new Map());
    void repo.getMoves(targetId).then((ms) => setExisting(new Map(ms.map((m) => [m.posKey, { uci: m.uci, san: m.san, note: m.note, tags: m.tags }]))));
  }, [targetId]);

  const tree = useMemo(() => (st ? buildStudyTree(st.pgn) : undefined), [st?.pgn]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = useMemo(() => (tree && st ? activeChapters(tree, st) : new Set<number>()), [tree, st]);

  // Übernahme-Plan im Hintergrund (am Handy einige 100 ms bei großen Studien)
  const deferredSt = useDeferredValue(st);
  const fullPlan = useMemo(() => {
    if (!deferredSt) return undefined;
    return planImport(deferredSt.pgn, deferredSt.color, existing, new Map(Object.entries(deferredSt.choices)), undefined, studyFilter(deferredSt));
  }, [deferredSt, existing]);
  // „Nur ab hier“: Weg zur aktuellen Stellung + alles darunter (große Studien stückweise übernehmen)
  const [scope, setScope] = useState<'all' | 'here'>('all');
  const plan = useMemo(() => {
    if (!fullPlan || scope === 'all' || !tree || !st) return fullPlan;
    return restrictPlan(fullPlan, keysFrom(tree, st, activeChapters(tree, st), path));
  }, [fullPlan, scope, tree, st, path]);

  const update = (patch: Partial<Study>) =>
    setSt((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });

  // aktuelle Stellung = Ende des Pfads (ungültige Reste einer gespeicherten Position werden abgeschnitten)
  const { currentKey, validLen } = useMemo(() => {
    if (!tree) return { currentKey: undefined, validLen: 0 };
    let key = tree.root;
    let n = 0;
    for (const step of path) {
      const m = step.key === key ? tree.nodes.get(step.key)?.moves.find((x) => x.uci === step.uci) : undefined;
      if (!m) break;
      key = m.child;
      n++;
    }
    return { currentKey: key, validLen: n };
  }, [tree, path]);
  useEffect(() => {
    if (tree && validLen < path.length) setPath((p) => p.slice(0, validLen));
  }, [tree, validLen, path.length]);

  // Fortschritt: angesehene Stellungen + letzte Position merken
  const order = useMemo(
    () => (tree && st ? readingOrder(tree, st, active, { skip: skipNotChosen(tree, st, active, existing) }) : []),
    [tree, st?.cuts, st?.choices, active, existing], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Fortschritt je Kapitel (für den Kapitel-Reiter)
  const chapterProgress = useMemo(() => {
    const out = new Map<number, { seen: number; total: number }>();
    if (!tree || !st || tab !== 'chapters') return out; // nur berechnen, wenn der Kapitel-Reiter offen ist
    const seen = new Set(st.seen ?? []);
    for (const c of tree.chapters) {
      if (!active.has(c.index)) continue;
      const one = new Set([c.index]);
      const o = readingOrder(tree, st, one, { skip: skipNotChosen(tree, st, one, existing) });
      out.set(c.index, { seen: o.filter((x) => seen.has(x.key)).length, total: o.length });
    }
    return out;
  }, [tree, st?.seen, st?.cuts, st?.choices, active, existing, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const seenSet = useMemo(() => new Set(st?.seen ?? []), [st?.seen]);
  const seenCount = useMemo(() => order.filter((x) => seenSet.has(x.key)).length, [order, seenSet]);
  useEffect(() => {
    if (!st || !tree || !currentKey || validLen < path.length) return;
    const seen = st.seen ?? [];
    const lastSame = JSON.stringify(st.lastPath ?? []) === JSON.stringify(path);
    if (seen.includes(currentKey) && lastSame) return;
    update({ seen: seen.includes(currentKey) ? seen : [...seen, currentKey], lastPath: path });
  }, [currentKey, path, tree]); // eslint-disable-line react-hooks/exhaustive-deps
  const node = currentKey ? tree?.nodes.get(currentKey) : undefined;
  const evalOn = useApp((s) => s.settings.ui.evalBar !== false);
  const engineSt = useEngine(node?.fen ?? '', evalOn && !!node);
  const view = node && st ? nodeView(node, st, active, existing) : undefined;
  const learn = useLearn({ tree, st, active, existing, update, setPath });
  const learning = !!learn?.on;
  const lastStep = path[path.length - 1];
  const lastMove = lastStep && tree ? tree.nodes.get(lastStep.key)?.moves.find((m) => m.uci === lastStep.uci) : undefined;
  const excluded = tree && st ? firstExcluded(tree, path, st, active, existing) : undefined;

  // Neue Stellung → aufgezogenes Sheet einklappen
  useEffect(() => {
    setSnap((s) => (s === 'full' ? 'min' : s)); // nach einem Zug wieder Brett + Text zeigen
  }, [currentKey]);

  const go = (uci: string) => {
    if (learning && learn) {
      if (!learn.play(uci)) toast('Dieser Zug gehört zu keiner Linie, die du lernst (nicht gewählt oder entfernt).', 'info');
      return;
    }
    if (!currentKey || !view?.moves.some((m) => m.uci === uci)) return toast('Dieser Zug kommt in der Studie hier nicht vor.', 'info');
    setPath((p) => [...p, { key: currentKey, uci }]);
  };
  const back = () => (learning && learn ? learn.prev() : setPath((p) => p.slice(0, -1)));
  const forward = () => {
    if (learning && learn) return learn.atEnd ? undefined : learn.next();
    const next = view?.moves.find((m) => m.status === 'chosen') ?? view?.moves.find((m) => m.status === 'opp') ?? view?.moves[0];
    if (next) go(next.uci);
  };
  const nextOpen = () => {
    if (!currentKey) return;
    const p = nextUnseen(order, seenSet, currentKey);
    if (!p) return toast('Alle Stellungen dieser Studie angesehen.', 'ok');
    setPath(p);
  };
  // Wischen über Brettsteuerung: links = vor, rechts = zurück (nicht in der Variantenleiste, die scrollt selbst)
  const touch = useRef<{ x: number; y: number } | undefined>(undefined);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current;
    touch.current = undefined;
    if (!t0 || (e.target as HTMLElement).closest('.var-chips')) return;
    const dx = e.changedTouches[0].clientX - t0.x;
    const dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) (dx < 0 ? forward : back)();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') back();
      if (e.key === 'ArrowRight') forward();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!st || !tree || !node || !view) return <p className="hint pad">Studie wird geladen …</p>;

  const sanLabel = (fen: string, san: string) => moveNumberPrefix(plyOfFen(fen)) + displaySan(san, notation);
  const toggleCut = (uci: string) => {
    const k = cutKey(node.key, uci);
    const has = st.cuts.includes(k);
    const choices = { ...st.choices };
    if (!has && choices[node.key] === uci) delete choices[node.key]; // Wahl auf einen entfernten Zug wäre wirkungslos
    update({ cuts: has ? st.cuts.filter((x) => x !== k) : [...st.cuts, k], choices });
  };
  const choose = (uci: string) => update({ choices: { ...st.choices, [node.key]: uci } });
  const target = repertoires.find((r) => r.id === targetId);
  // Nicht alle Fortsetzungen zeichnen (bei 12 Gegnerzügen unlesbar): gewählter Zug + die häufigsten (meiste Kapitel)
  const learnShape = (): DrawShape[] => {
    const e = learn?.expected;
    if (!e || (learn.quiz && !learn.hint)) return [];
    const sq = uciSquares(e.uci)!;
    return [{ orig: sq[0], dest: sq[1], brush: view.mine ? 'mine' : 'opp' }];
  };
  const shapes: DrawShape[] = learning ? learnShape() : view.moves
    .filter((m) => m.status !== 'cut')
    .sort((a, b) => Number(b.status === 'chosen') - Number(a.status === 'chosen') || b.chapters.length - a.chapters.length)
    .slice(0, 4)
    .map((m) => {
      const sq = uciSquares(m.uci)!;
      return { orig: sq[0], dest: sq[1], brush: m.status === 'chosen' ? 'mine' : m.status === 'alt' ? 'eng' : 'opp' };
    });

  const commit = async () => {
    if (!plan || !target) return;
    await repo.applyImport(target.id, plan, 'pgn');
    const entries = plan.stats.newEntries + plan.stats.replaced;
    update({ added: [...(st.added ?? []), { repertoireId: target.id, at: Date.now(), entries }] });
    await reloadRepertoires();
    if (useApp.getState().repId !== target.id) await selectRepertoire(target.id);
    else await loadRepData();
    toast(`Übernommen in „${target.name}“: +${plan.stats.newEntries} Einträge${plan.stats.replaced ? `, ${plan.stats.replaced} ersetzt` : ''}`, 'ok');
    setLine(lineFromUcis(studyStart(st.pgn, st.color)));
    setView('build');
  };

  const crumbs = (
    <nav className="crumbs" aria-label="Zugfolge in der Studie">
      <button className={path.length === 0 ? 'cur' : ''} onClick={() => (learning && learn ? learn.again() : setPath([]))} disabled={learning && !!learn?.line.start.length}>
        Start
      </button>
      {path.map((p, i) => {
        const n = tree.nodes.get(p.key)!;
        const m = n.moves.find((x) => x.uci === p.uci)!;
        const off = excluded && i >= excluded.index;
        const ctx = learning && learn && i < learn.line.start.length; // Weg bis zum Abzweig
        return (
          <button
            key={i}
            className={`${i === path.length - 1 ? 'cur' : ''} ${off ? 'off' : ''} ${ctx ? 'ctx' : ''}`}
            disabled={!!ctx}
            onClick={() => (learning && learn ? learn.goto(learn.idx, i + 1 - learn.line.start.length) : setPath(path.slice(0, i + 1)))}
          >
            {sanLabel(n.fen, m.san)}
          </button>
        );
      })}
    </nav>
  );

  const board = (
    <div className="board-row">
      {evalOn && <EvalBar fen={engineSt.fen} lines={engineSt.lines} depth={engineSt.depth} orientation={st.color} />}
      <Board fen={node.fen} orientation={st.color} lastMove={uciSquares(lastStep?.uci)} shapes={shapes} onMove={go} movable="turn" />
    </div>
  );
  const nextMoves = view.moves.filter((m) => m.status !== 'cut');
  const controls = (
    <div className="board-controls study-controls" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="btn icon" onClick={back} aria-label="Zug zurück" disabled={!path.length}><Icon name="prev" /></button>
      <button className="btn icon" onClick={forward} aria-label="Zug vor" disabled={!nextMoves.length}><Icon name="next" /></button>
      <div className="var-chips" role="group" aria-label="Nächste Züge">
        {nextMoves.length === 0 && <span className="hint">Ende der Linie</span>}
        {nextMoves.map((m, i) => (
          <button
            key={m.uci}
            className={`var-chip ${m.status} ${i === 0 ? 'main' : ''} ${seenSet.has(m.child) ? 'seen' : ''}`}
            onClick={() => go(m.uci)}
            title={m.comment}
          >
            {sanLabel(node.fen, m.san)}
            {m.comment && <i aria-label="mit Kommentar" />}
          </button>
        ))}
      </div>
    </div>
  );

  const head = (
    <div className="study-head">
      <button className="btn small ghost" onClick={() => useApp.setState({ studyId: undefined })}>
        <Icon name="prev" /> <span className="back-label">Studien</span>
      </button>
      {renaming ? (
        <input
          autoFocus
          defaultValue={st.name}
          aria-label="Name der Studie"
          onBlur={(e) => {
            if (e.target.value.trim()) update({ name: e.target.value.trim() });
            setRenaming(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button className="study-title" onClick={() => setRenaming(true)} title="Umbenennen">
          <span className={`kdot ${st.color}`} aria-hidden /> {st.name}
        </button>
      )}
      {learning && learn ? (
        <button
          className="study-progress"
          onClick={() => {
            setTab('moves');
            setSnap('full');
          }}
          aria-label={`Lernplan öffnen: ${learn.plan.lines.filter((l) => learn.done.has(l.id)).length} von ${learn.plan.lines.length} Linien geschafft`}
        >
          <i style={{ width: `${(100 * learn.plan.lines.filter((l) => learn.done.has(l.id)).length) / learn.plan.lines.length}%` }} />
          <b>
            {learn.plan.lines.filter((l) => learn.done.has(l.id)).length}/{learn.plan.lines.length}
          </b>
        </button>
      ) : (
        <button className="study-progress" onClick={nextOpen} aria-label={`Offen: zur nächsten nicht angesehenen Stellung (${seenCount} von ${order.length} angesehen)`}>
          <i style={{ width: `${order.length ? (100 * seenCount) / order.length : 0}%` }} />
          <b>
            {seenCount}/{order.length}
          </b>
          <Icon name="next" />
        </button>
      )}
      <div className="seg small study-mode" role="group" aria-label="Modus">
        <button aria-pressed={!learning} onClick={() => learn?.setOn(false)}>Lesen</button>
        <button aria-pressed={learning} onClick={() => learn?.setOn(true, currentKey)} title="Geführt Linie für Linie durch die Studie">
          Lernen
        </button>
      </div>
    </div>
  );

  // Text der Studie: Kommentar zum gerade gespielten Zug, auf der Startstellung die Einleitung
  const intro = path.length === 0 ? tree.chapters.find((c) => active.has(c.index) && c.intro)?.intro : undefined;
  const commentBlock = lastMove?.comment ? (
    <div className="note study-comment">
      <small>Kommentar zu {sanLabel(tree.nodes.get(lastStep.key)!.fen, lastMove.san)}</small>
      {lastMove.comment}
    </div>
  ) : intro ? (
    <div className="note study-comment">
      <small>Einleitung</small>
      {intro}
    </div>
  ) : undefined;

  const movesPanel = (
    <>
      {excluded && (
        <div className="outside" role="status">
          <span>
            {excluded.reason === 'cut' ? 'Dieser Ast ist entfernt' : 'Hier ist ein anderer eigener Zug gewählt'} – diese Stellung wird nicht übernommen.
          </span>
          <button className="btn small" onClick={() => setPath(path.slice(0, excluded.index))}>Zur Stelle</button>
        </div>
      )}
      {!mobile && commentBlock}
      <div className="study-turn">
        <b>{view.mine ? 'Du bist am Zug' : 'Gegner am Zug'}</b>
        {view.mine && view.repMove && !view.moves.some((m) => m.inRep) && (
          <span className="hint warn">
            Dein Repertoire spielt hier {displaySan(view.repMove.san, notation)} – Studienzüge werden nur übernommen, wenn du einen wählst.
          </span>
        )}
        {view.mine && view.moves.filter((m) => m.status !== 'cut').length > 1 && (
          <span className="hint">Mehrere eigene Züge in der Studie – ins Repertoire kommt nur der gewählte.</span>
        )}
      </div>
      {view.moves.length === 0 ? (
        <p className="hint">Ende der Studie in dieser Linie.</p>
      ) : (
        <ul className="study-moves">
          {view.moves.map((m) => {
            const size = m.status !== 'cut' ? subtreeSize(tree, m.child, active) : 0;
            return (
              <li key={m.uci} className={`smove ${m.status}`}>
                <button className="smove-go" onClick={() => go(m.uci)}>
                  <b className={view.mine ? 'me' : 'warn'}>{sanLabel(node.fen, m.san)}</b>
                  <span className="smove-tags">
                    {m.status === 'chosen' && <span className="tag ok">wird übernommen</span>}
                    {m.status === 'alt' && <span className="tag">nicht gewählt</span>}
                    {m.status === 'cut' && <span className="tag gap">entfernt</span>}
                    {m.inRep && <span className="tag rep">im Repertoire</span>}
                    <small>
                      {m.chapters.length > 1 ? `${m.chapters.length} Kapitel` : tree.chapters[m.chapters[0]]?.name}
                      {size > 1 && ` · ${size} Stellungen`}
                    </small>
                  </span>
                  {m.comment && <span className="smove-comment" title={m.comment}>{m.comment}</span>}
                </button>
                <span className="smove-acts">
                  {view.mine && m.status === 'alt' && (
                    <button className="btn small" onClick={() => choose(m.uci)}>Wählen</button>
                  )}
                  <button
                    className="btn small ghost"
                    onClick={() => toggleCut(m.uci)}
                    title={m.status === 'cut' ? 'Ast wiederherstellen' : 'Ast entfernen (nicht übernehmen)'}
                    aria-label={m.status === 'cut' ? `${m.san} wiederherstellen` : `${m.san} entfernen`}
                  >
                    <Icon name={m.status === 'cut' ? 'undo' : 'scissors'} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  const chaptersPanel = (
    <ul className="study-chapters">
      {tree.chapters.map((c) => {
        const other = !!c.color && c.color !== st.color;
        const on = !st.skipChapters.includes(c.index) && !other;
        return (
          <li key={c.index} className={on ? '' : 'off'}>
            <label className="check">
              <input
                type="checkbox"
                checked={on}
                disabled={other}
                onChange={(e) =>
                  update({ skipChapters: e.target.checked ? st.skipChapters.filter((x) => x !== c.index) : [...st.skipChapters, c.index] })
                }
              />
              <span>
                <b>{c.name}</b>
                {other && <small> · für {c.color === 'white' ? 'Weiß' : 'Schwarz'}</small>}
                {chapterProgress.get(c.index) && (
                  <small className="ch-progress">
                    {' '}
                    · {chapterProgress.get(c.index)!.seen}/{chapterProgress.get(c.index)!.total} angesehen
                  </small>
                )}
              </span>
            </label>
            {!other && (
              <button
                className="btn small"
                onClick={() => {
                  setPath(chapterEntry(tree, c.index));
                  setTab('moves');
                }}
              >
                Ansehen
              </button>
            )}
            {c.intro && <p className="hint">{c.intro.length > 220 ? c.intro.slice(0, 220) + ' …' : c.intro}</p>}
          </li>
        );
      })}
    </ul>
  );

  const commitBar = (
    <div className={mobile ? 'study-commit inline' : 'study-commit'}>
      <div className="study-stats">
        {plan ? (
          <>
            <b className="me">+{plan.stats.newEntries}</b> neu
            {plan.stats.replaced > 0 && (
              <>
                {' '}
                · <b className="warn">{plan.stats.replaced}</b> ersetzt
              </>
            )}
            {' '}· {plan.stats.existing} schon vorhanden · {st.cuts.length} entfernt
          </>
        ) : (
          '…'
        )}
      </div>
      <div className="seg small commit-scope" role="group" aria-label="Umfang der Übernahme">
        <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Alles</button>
        <button aria-pressed={scope === 'here'} onClick={() => setScope('here')} title="Nur die aktuelle Stellung und alles darunter">
          Nur ab hier
        </button>
      </div>
      <div className="row-actions">
        <select value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value)} aria-label="Ziel-Repertoire">
          {repertoires.filter((r) => r.color === st.color).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
          {!repertoires.some((r) => r.color === st.color) && <option value="">kein {st.color === 'white' ? 'Weiß' : 'Schwarz'}-Repertoire</option>}
        </select>
        <button className="btn primary" disabled={!plan || !target || plan.stats.newEntries + plan.stats.replaced === 0} onClick={() => setConfirm(true)}>
          Zum Repertoire hinzufügen
        </button>
      </div>
    </div>
  );

  const tabs = (
    <div className="seg small bs-tabs" role="tablist" aria-label="Bereich">
      <button role="tab" aria-selected={tab === 'moves'} aria-pressed={tab === 'moves'} onClick={() => { setTab('moves'); setSnap((x) => (x === 'min' ? 'full' : x)); }}>{learning ? 'Plan' : 'Züge'}</button>
      <button role="tab" aria-selected={tab === 'chapters'} aria-pressed={tab === 'chapters'} onClick={() => { setTab('chapters'); setSnap((x) => (x === 'min' ? 'full' : x)); }}>
        Kapitel ({tree.chapters.filter((c) => active.has(c.index)).length}/{tree.chapters.length})
      </button>
    </div>
  );

  return (
    <div className={mobile ? 'study study-m' : 'study'}>
      {mobile ? (
        <>
          <section className="col-board" ref={boardRef}>
            {head}
            {crumbs}
            {board}
            {learning && learn ? <LearnControls learn={learn} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} /> : controls}
            {learning && learn && <LearnCard learn={learn} tree={tree} view={view} fen={node.fen} notation={notation} st={st} onChoose={choose} />}
            {commentBlock ?? (!learning && <p className="hint study-nocomment">Kein Kommentar zu diesem Zug.</p>)}
          </section>
          <BottomSheet anchorRef={boardRef} snap={snap} onSnap={setSnap} header={tabs}>
            {tab === 'moves' ? (learning && learn ? <LearnPlan learn={learn} tree={tree} notation={notation} /> : movesPanel) : chaptersPanel}
            {commitBar}
          </BottomSheet>
        </>
      ) : (
        <>
          <section className="col-board">
            {head}
            {crumbs}
            {board}
            {learning && learn ? <LearnControls learn={learn} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} /> : controls}
          </section>
          <section className="col-panel">
            {tabs}
            <div className="study-panel">
              {tab === 'moves' ? (
                learning && learn ? (
                  <>
                    <LearnCard learn={learn} tree={tree} view={view} fen={node.fen} notation={notation} st={st} onChoose={choose} />
                    {commentBlock}
                    <LearnPlan learn={learn} tree={tree} notation={notation} />
                  </>
                ) : (
                  movesPanel
                )
              ) : (
                chaptersPanel
              )}
            </div>
            {commitBar}
          </section>
        </>
      )}
      {confirm && plan && target && (
        <Modal
          title={`In „${target.name}“ übernehmen?`}
          onClose={() => setConfirm(false)}
          actions={[
            {
              label: 'Übernehmen',
              kind: 'primary',
              onClick: () => {
                setConfirm(false);
                void commit().catch((e) => toast(String(e), 'err'));
              },
            },
            { label: 'Abbrechen', kind: 'ghost', onClick: () => setConfirm(false) },
          ]}
        >
          <p>
            <b className="me">+{plan.stats.newEntries} neue Einträge</b> (werden neue Lernkarten)
            {plan.stats.replaced > 0 && (
              <>
                {' '}
                und <b className="warn">{plan.stats.replaced} ersetzte Züge</b> – deren Lernstand verfällt
              </>
            )}
            .
          </p>
          {plan.stats.newEntries > 100 && (
            <p className="hint">
              Viele neue Karten: Im Training kommen zuerst die häufigsten Stellungen. Unter Mehr → Training kannst du seltene Stellungen zurückstellen
              („Neue Karten erst ab Erreichbarkeit“).
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

/** Plan auf bestimmte Stellungen beschränken (Teilübernahme) – Zahlen neu zählen. */
function restrictPlan(plan: ImportPlan, keys: Set<string>): ImportPlan {
  const entries = plan.entries.filter((e) => keys.has(e.posKey));
  return {
    ...plan,
    entries,
    marks: plan.marks.filter((m) => keys.has(m.posKey)),
    stats: {
      ...plan.stats,
      newEntries: entries.filter((e) => e.status === 'new').length,
      existing: entries.filter((e) => e.status === 'unchanged' || e.status === 'update').length,
      replaced: entries.filter((e) => e.status === 'replace').length,
    },
  };
}
