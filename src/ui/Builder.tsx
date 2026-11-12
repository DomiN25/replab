// Ansicht „Bauen“: Brett | Kandidaten + Notizen | Galaxie/Liste.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrawShape } from 'chessground/draw';
import type { Color, RepertoireMove } from '../core/types';
import type { LineStep } from './store';
import { Board, uciSquares } from './Board';
import { Candidates } from './Candidates';
import { Galaxy, GalaxyLegend } from './Galaxy';
import { TreeList } from './TreeList';
import { Modal } from './Modal';
import { GuideBar, startGuide, stopGuide } from './GuideBar';
import { useEngine, useExplorer, useMediaQuery } from './hooks';
import { EvalBar } from './EvalBar';
import { useStudySuggestions } from './studySuggest';
import { useOppStats } from './games';
import { BottomSheet, type SheetSnap } from './BottomSheet';
import {
  back,
  currentRep,
  deleteMyMoves,
  forward,
  gotoCursor,
  gotoNode,
  playMove,
  setMyMove,
  toast,
  useApp,
} from './store';
import { displaySan, playSan, playUci, plyOfFen, posKeyOf, turnOf, moveNumberPrefix } from '../core/chess';
import { oppCandidates } from '../core/relevance';
import { Scheduler } from '../core/srs';
import { repo } from '../data/repo';
import { Icon } from './Icon';
import { SearchDialog } from './Search';
import { normalizeSanToken } from '../core/search';

interface PendingCommit {
  fen: string;
  uci: string;
  san: string;
  playAfter: boolean;
  warning?: string;
}

export function Builder() {
  const rep = currentRep();
  const line = useApp((s) => s.line);
  const cursor = useApp((s) => s.cursor);
  const graph = useApp((s) => s.graph);
  const moves = useApp((s) => s.moves);
  const marks = useApp((s) => s.marks);
  const cards = useApp((s) => s.cards);
  const settings = useApp((s) => s.settings);
  const flipped = useApp((s) => s.flipped);
  const engineOn = useApp((s) => s.engineOn);
  const galaxyMode = useApp((s) => s.galaxyMode);
  const sideView = useApp((s) => s.sideView);
  const guideActive = useApp((s) => s.guide.active);
  const [source, setSource] = useState<'lichess' | 'masters'>('lichess');
  const [pending, setPending] = useState<PendingCommit | undefined>();
  const [orphanCheck, setOrphanCheck] = useState(false);
  const [orphans, setOrphans] = useState<string[] | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mobile = useMediaQuery('(max-width: 899px)');
  const boardRef = useRef<HTMLElement>(null);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');
  const [sheetTab, setSheetTabRaw] = useState<'moves' | 'map'>(() => {
    try {
      return localStorage.getItem('replab.sheetTab') === 'map' ? 'map' : 'moves';
    } catch {
      return 'moves';
    }
  });
  const setSheetTab = (t: 'moves' | 'map') => {
    setSheetTabRaw(t);
    try {
      localStorage.setItem('replab.sheetTab', t);
    } catch {
      /* privat/blockiert */
    }
  };
  const [searching, setSearching] = useState(false);
  const [typed, setTyped] = useState('');
  // Erkunden: Züge am Brett legen nichts fest (nur der Knopf in der Zugtabelle). Pro Gerät gemerkt.
  const [explore, setExplore] = useState(() => {
    try {
      return localStorage.getItem('replab.explore') === '1';
    } catch {
      return false;
    }
  });
  const toggleExplore = () => {
    const on = !explore;
    setExplore(on);
    try {
      localStorage.setItem('replab.explore', on ? '1' : '0');
    } catch {
      /* privat/blockiert */
    }
    toast(on ? 'Erkunden an: Züge am Brett werden nicht festgelegt.' : 'Erkunden aus: Ein Zug am Brett legt deinen Repertoirezug fest.', 'info');
  };

  const step = line[cursor];
  const fen = step.fen;
  const posKey = posKeyOf(fen);
  const myColor = rep?.color ?? 'white';
  const myTurn = turnOf(fen) === myColor;
  const entry = moves.get(posKey);
  const mark = marks.get(posKey);
  const nodeId = graph?.byPosKey.get(posKey);
  const node = nodeId !== undefined ? graph!.nodes[nodeId] : undefined;

  // Abweichung vom Repertoire auf dem Weg bis hierher: erste eigene Stellung, in der ein anderer Zug gespielt wurde
  const deviation = useMemo(() => findDeviation(line, cursor, myColor, moves), [line, cursor, myColor, moves]);

  const suggestions = useStudySuggestions(posKey, myColor);
  const games = useOppStats(myColor);
  const explorerSt = useExplorer(fen, 'lichess');
  const mastersSt = useExplorer(fen, source === 'masters' ? 'masters' : 'lichess');
  const evalOn = settings.ui.evalBar !== false;
  // Häufige Datenbankzüge sollen immer eine Bewertung haben – auch wenn Stockfish sie nicht unter seinen besten Linien führt
  const extraMoves = useMemo(() => {
    const d = explorerSt.data;
    if (!d || !engineOn) return [];
    const total = d.moves.reduce((n, m) => n + m.white + m.draws + m.black, 0) || 1;
    return d.moves.filter((m) => (m.white + m.draws + m.black) / total >= 0.01).slice(0, 8).map((m) => m.uci);
  }, [explorerSt.data, engineOn]);
  // Balken braucht die Engine auch, wenn die Linien aus sind; weitergerechnet wird nur bei „Stockfish an“
  const engineRaw = useEngine(fen, engineOn || evalOn, { deep: engineOn, extraMoves });
  // „Stockfish aus“ heißt weiterhin: keine Engine-Linien, -Pfeile oder -Kandidaten – nur der Balken rechnet
  const engineSt = useMemo(() => (engineOn ? engineRaw : { ...engineRaw, lines: [], extra: [], depth: 0, running: false }), [engineOn, engineRaw]);

  // Fokus der Galaxie: aktuelle Stellung, falls sie Kinder hat, sonst ihr Elternknoten.
  // Außerhalb des Repertoires: tiefster bekannter Vorfahr auf dem Weg.
  const { focusId, currentId, outside } = useMemo(() => {
    if (!graph) return { focusId: 0, currentId: undefined, outside: false };
    let cur: number | undefined = nodeId;
    let out = false;
    if (cur === undefined) {
      out = true;
      for (let i = cursor; i >= 0; i--) {
        const id = graph.byPosKey.get(posKeyOf(line[i].fen));
        if (id !== undefined) {
          cur = id;
          break;
        }
      }
    }
    const c = cur ?? 0;
    const n = graph.nodes[c];
    const f = n.children.length || c === 0 ? c : Math.max(0, n.parent);
    return { focusId: f, currentId: c, outside: out };
  }, [graph, nodeId, cursor, line]);

  // Abrufwahrscheinlichkeit pro Stellung (für Heatmap/Liste)
  const rOf = useMemo(() => {
    const sch = new Scheduler(settings.srs.desiredRetention);
    const now = Date.now();
    const cache = new Map<string, number | undefined>();
    return (k: string) => {
      if (cache.has(k)) return cache.get(k);
      const c = cards.get(k);
      const r = c ? sch.retrievability(c.srs, now) : undefined;
      cache.set(k, r);
      return r;
    };
  }, [cards, settings.srs.desiredRetention]);

  // Pfeile: grün = mein Zug, gelb gestrichelt = relevante Gegnerzüge (Dicke nach Anteil), blau = Engine-Bester
  const shapes = useMemo<DrawShape[]>(() => {
    const out: DrawShape[] = [];
    const best = engineOn ? engineSt.lines[0]?.uci : undefined;
    if (myTurn) {
      const sq = uciSquares(entry?.uci);
      if (sq) out.push({ orig: sq[0], dest: sq[1], brush: 'mine' });
      const b = uciSquares(best);
      if (b && best !== entry?.uci) out.push({ orig: b[0], dest: b[1], brush: 'eng' });
    } else {
      const cands = oppCandidates({
        fen,
        explorer: explorerSt.data,
        engine: engineSt.lines.length ? { posKey, depth: engineSt.depth, lines: engineSt.lines, analysedAt: 0 } : undefined,
        mark,
        settings: {
          minShare: settings.explorer.minShare,
          minGames: settings.explorer.minGames,
          nearBestCp: settings.engine.nearBestCp,
          trapLossCp: settings.engine.trapLossCp,
          trapMinShare: settings.engine.trapMinShare,
        },
      }).filter((c) => c.relevant);
      // Dicke dezent nach Häufigkeit (4…13 von 64 Feldbreite); häufigster Zug am dicksten
      const maxShare = Math.max(...cands.map((c) => c.share ?? 0), 0.01);
      for (const c of cands.slice(0, 6)) {
        const sq = uciSquares(c.uci);
        if (!sq) continue;
        const rel = c.share !== undefined ? c.share / maxShare : 0.4;
        out.push({ orig: sq[0], dest: sq[1], brush: 'opp', modifiers: { lineWidth: 4 + Math.round(9 * Math.sqrt(rel)) } });
      }
      const b = uciSquares(best);
      if (b && best !== cands[0]?.uci) out.push({ orig: b[0], dest: b[1], brush: 'eng' });
    }
    return out;
  }, [myTurn, entry, engineOn, engineSt, explorerSt.data, fen, mark, posKey, settings]);

  // Prüfen, ob nach einer Änderung alte Äste verwaist sind
  useEffect(() => {
    if (!orphanCheck || !graph) return;
    setOrphanCheck(false);
    if (graph.orphans.length) setOrphans(graph.orphans);
  }, [graph, orphanCheck]);

  /** Alle Gegnerzüge des aktuellen Wegs, die noch nicht im Graphen sind, als relevant markieren. */
  const ensureReachable = useCallback(async () => {
    if (!graph || !rep) return;
    for (let i = 1; i <= cursor; i++) {
      const prev = line[i - 1];
      const st = line[i];
      if (turnOf(prev.fen) === rep.color) continue; // mein Zug
      const childKey = posKeyOf(st.fen);
      if (!graph.byPosKey.has(childKey)) {
        await repo.toggleOppMove(rep.id, posKeyOf(prev.fen), st.uci!, 'extra', true);
      }
    }
  }, [graph, rep, cursor, line]);

  const unreachableWarning = useCallback((): string | undefined => {
    if (!rep) return;
    for (let i = 1; i <= cursor; i++) {
      const prev = line[i - 1];
      if (turnOf(prev.fen) !== rep.color) continue;
      const e = moves.get(posKeyOf(prev.fen));
      if (e && e.uci !== line[i].uci) {
        return `Achtung: Auf diesem Weg weichst du bei ${moveNumberPrefix(i - 1)}${displaySan(line[i].san!, settings.ui.notation)} von deinem Repertoirezug ${displaySan(e.san, settings.ui.notation)} ab. Die Stellung ist dann nur über Zugumstellung erreichbar.`;
      }
    }
    return undefined;
  }, [rep, cursor, line, moves, settings.ui.notation]);

  const commit = async (c: PendingCommit, resetHistory: boolean) => {
    const prev = moves.get(posKeyOf(c.fen));
    const changing = !!prev && prev.uci !== c.uci;
    await ensureReachable();
    await setMyMove(c.fen, c.uci, c.san, resetHistory);
    if (c.playAfter) playMove(c.uci);
    if (changing) {
      toast(`${displaySan(c.san, settings.ui.notation)} festgelegt`, 'ok');
      setOrphanCheck(true);
      return;
    }
    // Neuer Zug: ohne Rückfrage, dafür rückgängig machbar (nur dieser Eintrag samt neuer Karte)
    const key = posKeyOf(c.fen);
    toast(`${moveNumberPrefix(plyOfFen(c.fen))}${displaySan(c.san, settings.ui.notation)} festgelegt`, 'ok', {
      label: 'Rückgängig',
      run: () => {
        void deleteMyMoves([key]).then(() => {
          const st = useApp.getState();
          // Brett steht noch eine Stellung weiter? → zurück an die Stelle der Entscheidung
          if (c.playAfter && st.cursor > 0 && posKeyOf(st.line[st.cursor - 1].fen) === key) back();
          toast('Rückgängig gemacht', 'info');
        });
      },
    });
  };

  /** Neuer eigener Zug: direkt festlegen (Rückgängig in der Meldung). Dialog nur, wenn etwas zu bedenken ist. */
  const decide = (c: PendingCommit) => {
    const existing = moves.get(posKeyOf(c.fen));
    if (!existing && !c.warning) void commit(c, false);
    else setPending(c);
  };

  const onBoardMove = (uci: string) => {
    let san = uci;
    try {
      san = playUci(fen, uci).san;
    } catch {
      return;
    }
    // Erkunden (auch in der Lückentour): Linien am Brett ansehen, ohne etwas festzulegen
    if (myTurn && !entry && !mark?.endOfLine && !explore) {
      decide({ fen, uci, san, playAfter: true, warning: unreachableWarning() });
      return;
    }
    playMove(uci);
  };

  const onCommit = (uci: string, san: string) => {
    decide({ fen, uci, san, playAfter: false, warning: unreachableWarning() });
  };

  const onSelectNode = (id: number) => {
    if (!graph) return;
    const n = graph.nodes[id];
    gotoNode(n.status === 'transposition' ? n.transposeOf! : id);
  };

  const onGalaxyBack = () => {
    if (!graph || focusId === 0) return;
    gotoNode(graph.nodes[focusId].parent);
  };

  // Tastatur: ← → Navigation, f drehen, Leertaste Engine
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal')) return;
      if (e.key === 'ArrowLeft') back();
      else if (e.key === 'ArrowRight') forward();
      else if (e.key === 'f') useApp.setState((s) => ({ flipped: !s.flipped }));
      else if (e.key === '/') {
        e.preventDefault();
        setSearching(true);
      }
      else if (e.key === ' ') {
        e.preventDefault();
        useApp.setState((s) => ({ engineOn: !s.engineOn }));
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wischgesten unter dem Brett (Handy)
  const touch = useRef<{ x: number; y: number } | undefined>(undefined);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) (dx < 0 ? forward : back)();
    touch.current = undefined;
  };

  // Neue Stellung (Zug in der Tabelle, Galaxie, Brett): aufgezogenes Sheet einklappen, damit das Brett sichtbar ist
  useEffect(() => {
    setSheetSnap((s) => (s === 'full' ? 'peek' : s)); // eingeklappt bleibt eingeklappt
  }, [fen]);

  if (!rep) return <p className="empty">Lege zuerst ein Repertoire an (Start oder Einstellungen).</p>;

  const orientation = flipped ? (myColor === 'white' ? 'black' : 'white') : myColor;
  const existing = pending ? moves.get(posKeyOf(pending.fen)) : undefined;

  const modeSwitch = (
    <div className="mode-switch seg" role="group" aria-label="Modus">
      <button aria-pressed={!guideActive} onClick={stopGuide}>Frei</button>
      <button aria-pressed={guideActive} onClick={() => startGuide()}>Lückentour</button>
    </div>
  );
  const board = (
    <div className="board-row">
      {evalOn && <EvalBar fen={engineRaw.fen} lines={engineRaw.lines} depth={engineRaw.depth} orientation={orientation} />}
      <Board fen={fen} orientation={orientation} lastMove={uciSquares(step.uci)} shapes={shapes} onMove={onBoardMove} />
    </div>
  );
  const navButtons = (
    <>
      {/* am Handy ist die Reihe voll – „Start“ in der Zugleiste springt ebenfalls zum Anfang */}
      {!mobile && <button className="btn icon" onClick={() => gotoCursor(0)} aria-label="Zum Anfang"><Icon name="first" /></button>}
      <button className="btn icon" onClick={back} aria-label="Zug zurück"><Icon name="prev" /></button>
      <button className="btn icon" onClick={forward} aria-label="Zug vor"><Icon name="next" /></button>
      <button className="btn icon" onClick={() => useApp.setState({ flipped: !flipped })} aria-label="Brett drehen (f)"><Icon name="flip" /></button>
      <button className="btn icon" onClick={() => setSearching(true)} aria-label="Im Repertoire suchen (/)" title="Suchen (/)"><Icon name="search" /></button>
      <button
        className="btn icon explore-toggle"
        aria-pressed={explore}
        onClick={toggleExplore}
        aria-label="Erkunden: Züge am Brett nicht festlegen"
        title={explore ? 'Erkunden an – Züge am Brett werden nicht festgelegt' : 'Erkunden – Züge am Brett nur ansehen, nichts festlegen'}
        data-testid="explore"
      >
        <Icon name="eye" />
      </button>
    </>
  );
  // Desktop: Zug tippen (deutsch oder englisch) + Enter – wie ein Zug am Brett
  const playTyped = () => {
    const tok = normalizeSanToken(typed);
    if (!tok) return;
    const p = (() => {
      try {
        return playSan(fen, tok);
      } catch {
        return undefined;
      }
    })();
    if (!p) return toast(`„${typed}“ ist hier kein legaler Zug.`, 'err');
    setTyped('');
    onBoardMove(p.uci);
  };
  const outsideBanner = deviation ? (
    <div className="outside" role="status" data-testid="outside">
      <span>
        <b>Außerhalb des Repertoires:</b> Dein Repertoire spielt{' '}
        <b className="me">{deviation.label}{displaySan(deviation.repSan, settings.ui.notation)}</b>, hier wurde {deviation.label}
        {displaySan(deviation.playedSan, settings.ui.notation)} gespielt.
      </span>
      <span className="row-actions">
        <button className="btn small" onClick={() => gotoCursor(deviation.index)}>Zur Abweichung</button>
        <button
          className="btn small"
          onClick={() => {
            gotoCursor(deviation.index);
            setTimeout(() => playMove(deviation.repUci), 0);
          }}
        >
          Repertoirezug spielen
        </button>
      </span>
    </div>
  ) : node === undefined && graph && cursor > 0 ? (
    <div className="outside soft" role="status" data-testid="outside">
      <span>Diese Stellung kommt in deinem Repertoire-Baum nicht vor (Gegnerzug nicht vorbereitet oder Zugfolge außerhalb).</span>
    </div>
  ) : null;
  const candidates = (
          <Candidates
            fen={fen}
            myTurn={myTurn}
            node={node}
            graph={graph}
            lineSans={line.slice(1, cursor + 1).map((s) => s.san!)}
            entry={entry}
            mark={mark}
            explorer={explorerSt}
            masters={mastersSt}
            engine={engineSt}
            source={source}
            onSource={setSource}
            onPlay={playMove}
            onCommit={onCommit}
            onDeleteEntry={() => setConfirmDelete(true)}
            suggestions={suggestions}
            games={games}
            onFocus={() => {
              setSheetSnap((s) => (s === 'full' ? 'peek' : s));
              startGuide(undefined, posKey);
            }}
          />
  );
  const side = (
    <>
          <div className="side-head">
            <div className="seg small" role="group" aria-label="Ansicht">
              <button aria-pressed={sideView === 'galaxy'} onClick={() => useApp.setState({ sideView: 'galaxy' })}>Galaxie</button>
              <button aria-pressed={sideView === 'list'} onClick={() => useApp.setState({ sideView: 'list' })}>Liste</button>
            </div>
            {sideView === 'galaxy' && (
              <div className="seg small" role="group" aria-label="Farbmodus">
                <button aria-pressed={galaxyMode === 'family'} onClick={() => useApp.setState({ galaxyMode: 'family' })}>Familie</button>
                <button aria-pressed={galaxyMode === 'knowledge'} onClick={() => useApp.setState({ galaxyMode: 'knowledge' })}>Wissen</button>
              </div>
            )}
          </div>
          {!graph ? (
            <p className="hint">Repertoire wird berechnet …</p>
          ) : sideView === 'galaxy' ? (
            <>
              <Galaxy
                graph={graph}
                focusId={focusId}
                currentId={currentId}
                mode={galaxyMode}
                rOf={rOf}
                notation={settings.ui.notation}
                onSelect={onSelectNode}
                onBack={onGalaxyBack}
                outside={outside}
              />
              <GalaxyLegend mode={galaxyMode} graph={graph} />
              {outside && <p className="hint">Aktuelle Stellung liegt außerhalb des Repertoires – Galaxie zeigt den letzten bekannten Punkt.</p>}
            </>
          ) : (
            <TreeList graph={graph} currentId={currentId} notation={settings.ui.notation} showReach={settings.ui.showReach} rOf={rOf} onSelect={onSelectNode} />
          )}
    </>
  );

  return (
    <div className={mobile ? 'builder builder-m' : 'builder'}>
      {mobile ? (
        <>
          <section className="col-board" ref={boardRef}>
            <Crumbs devIndex={deviation?.index} />
            {board}
            <div className="board-controls" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              {navButtons}
              {modeSwitch}
            </div>
          </section>
          <BottomSheet
            anchorRef={boardRef}
            snap={sheetSnap}
            onSnap={setSheetSnap}
            header={
              <div className="seg small bs-tabs" role="tablist" aria-label="Bereich">
                <button role="tab" aria-selected={sheetTab === 'moves'} aria-pressed={sheetTab === 'moves'} onClick={() => { setSheetTab('moves'); setSheetSnap((s) => (s === 'min' ? 'full' : s)); }}>Züge</button>
                <button role="tab" aria-selected={sheetTab === 'map'} aria-pressed={sheetTab === 'map'} onClick={() => { setSheetTab('map'); setSheetSnap((s) => (s === 'min' ? 'full' : s)); }}>Übersicht</button>
              </div>
            }
          >
            {sheetTab === 'moves' ? (
              <>
                {outsideBanner}
                <GuideBar />
                {candidates}
              </>
            ) : (
              side
            )}
          </BottomSheet>
        </>
      ) : (
        <>
          <section className="col-board">
            {modeSwitch}
            <Crumbs devIndex={deviation?.index} />
            {board}
            <div className="board-controls" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              {navButtons}
              <input
                className="move-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') playTyped();
                  e.stopPropagation(); // Pfeiltasten/„f“ im Feld nicht als Kürzel
                }}
                placeholder="Zug tippen, z. B. Sf3"
                aria-label="Zug eingeben"
              />
            </div>
            {explore && (
              <p className="explore-note" role="status">
                <Icon name="eye" /> Erkunden: Züge am Brett werden nicht festgelegt – festlegen über die Zugtabelle.
              </p>
            )}
            <p className="kbd-hint">
              <kbd>←</kbd> <kbd>→</kbd> blättern · <kbd>F</kbd> Brett drehen · <kbd>/</kbd> suchen · Zug tippen + <kbd>Enter</kbd>
            </p>
          </section>
          <section className="col-panel sheet">
            {/* Lückentour oben im Panel (nicht über dem Brett): das Brett braucht die Höhe */}
            <GuideBar />
            {outsideBanner}
            {candidates}
          </section>
          <section className="col-side">{side}</section>
        </>
      )}

      {searching && <SearchDialog onClose={() => setSearching(false)} />}
      {pending && (
        <Modal
          title={existing ? 'Repertoirezug ändern?' : 'Als Repertoirezug festlegen?'}
          onClose={() => {
            if (pending.playAfter) playMove(pending.uci);
            setPending(undefined);
          }}
          actions={
            existing
              ? [
                  { label: 'Ändern, Lernstand behalten', kind: 'primary', onClick: () => { void commit(pending, false); setPending(undefined); } },
                  { label: 'Ändern, Lernstand verwerfen', onClick: () => { void commit(pending, true); setPending(undefined); } },
                  { label: 'Abbrechen', kind: 'ghost', onClick: () => setPending(undefined) },
                ]
              : [
                  { label: 'Festlegen', kind: 'primary', onClick: () => { void commit(pending, false); setPending(undefined); } },
                  {
                    label: 'Nur ansehen',
                    kind: 'ghost',
                    onClick: () => {
                      if (pending.playAfter) playMove(pending.uci);
                      setPending(undefined);
                    },
                  },
                ]
          }
        >
          <p>
            In dieser Stellung spielst du{' '}
            <b className="me">{moveNumberPrefix(plyOfFen(pending.fen)) + displaySan(pending.san, settings.ui.notation)}</b>
            {existing && <> statt {displaySan(existing.san, settings.ui.notation)}</>}.
          </p>
          {existing && <p className="hint">Der alte Ast bleibt gespeichert; danach kannst du nicht mehr erreichbare Einträge aufräumen.</p>}
          {pending.warning && <p className="hint warn">{pending.warning}</p>}
        </Modal>
      )}

      {orphans && (
        <Modal
          title="Nicht mehr erreichbare Einträge"
          onClose={() => setOrphans(undefined)}
          actions={[
            { label: `${orphans.length} löschen`, kind: 'danger', onClick: () => { void deleteMyMoves(orphans); setOrphans(undefined); toast('Alter Ast entfernt', 'ok'); } },
            { label: 'Behalten', kind: 'ghost', onClick: () => setOrphans(undefined) },
          ]}
        >
          <p>{orphans.length} Einträge (inkl. Lernstand) hängen am alten Zug und sind nicht mehr erreichbar. Löschen?</p>
          <p className="hint">Behalten ist unschädlich; sie erscheinen unter „Lücken → Verwaiste Einträge“.</p>
        </Modal>
      )}

      {confirmDelete && entry && (
        <Modal
          title="Zug entfernen?"
          onClose={() => setConfirmDelete(false)}
          actions={[
            {
              label: 'Entfernen',
              kind: 'danger',
              onClick: () => {
                void deleteMyMoves([entry.posKey]).then(() => setOrphanCheck(true));
                setConfirmDelete(false);
              },
            },
            { label: 'Abbrechen', kind: 'ghost', onClick: () => setConfirmDelete(false) },
          ]}
        >
          <p>
            {displaySan(entry.san, settings.ui.notation)} und der Lernstand dieser Stellung werden gelöscht. Folgende Einträge bleiben erhalten und können danach aufgeräumt
            werden.
          </p>
        </Modal>
      )}
    </div>
  );
}

interface Deviation {
  /** Index im Pfad der eigenen Stellung, in der abgewichen wurde */
  index: number;
  label: string;
  repUci: string;
  repSan: string;
  playedSan: string;
}

function findDeviation(line: LineStep[], cursor: number, color: Color, moves: Map<string, RepertoireMove>): Deviation | undefined {
  for (let i = 0; i < cursor; i++) {
    const at = line[i];
    if (turnOf(at.fen) !== color) continue;
    const entry = moves.get(posKeyOf(at.fen));
    const next = line[i + 1];
    if (entry && next?.uci && entry.uci !== next.uci) {
      const ply = plyOfFen(at.fen);
      return { index: i, label: moveNumberPrefix(ply), repUci: entry.uci, repSan: entry.san, playedSan: next.san ?? next.uci };
    }
  }
  return undefined;
}

function Crumbs({ devIndex }: { devIndex?: number }) {
  const line = useApp((s) => s.line);
  const cursor = useApp((s) => s.cursor);
  const notation = useApp((s) => s.settings.ui.notation);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // nur waagerecht scrollen – scrollIntoView zieht sonst die ganze Seite mit (Brett springt)
    const nav = ref.current;
    const cur = nav?.querySelector<HTMLElement>('.cur');
    if (nav && cur) nav.scrollTo({ left: Math.max(0, cur.offsetLeft - nav.clientWidth + cur.offsetWidth + 40), behavior: 'smooth' });
  }, [cursor]);
  return (
    <nav className="crumbs" ref={ref} aria-label="Zugfolge">
      <button className={cursor === 0 ? 'cur' : ''} onClick={() => gotoCursor(0)}>Start</button>
      {line.slice(1).map((s, i) => {
        const ply = plyOfFen(line[i].fen);
        const label = (ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}.` : '') + displaySan(s.san!, notation);
        return (
          <button
            key={i}
            className={`${cursor === i + 1 ? 'cur' : ''} ${i + 1 > cursor ? 'ahead' : ''} ${devIndex !== undefined && i >= devIndex ? 'off' : ''}`}
            title={devIndex !== undefined && i === devIndex ? 'Hier weicht die Zugfolge von deinem Repertoire ab' : undefined}
            onClick={() => gotoCursor(i + 1)}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

