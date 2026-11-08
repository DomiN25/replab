// Geführter Aufbau („Lücken schließen“): bringt dich zur Lücke, die am nächsten am Anfang liegt.
// Du analysierst, legst deinen Zug fest – und es geht automatisch zur nächsten Lücke weiter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { nextGap, oppSiblings, openGapCount, type GuideStrategy } from '../core/guide';
import { pathUcis } from '../core/graph';
import { displaySan, formatLine, playUci, posKeyOf, moveNumberPrefix } from '../core/chess';
import { explorer, explorerParams, gotoNode, lichessToken, requestGraph, setEndOfLine, toggleOpp, toast, useApp } from './store';

export interface GuideState {
  active: boolean;
  strategy: GuideStrategy;
  minReach: number;
  skipped: string[];
  currentKey?: string;
  lastPath?: string[];
}

export const DEFAULT_GUIDE: GuideState = { active: false, strategy: 'shallow', minReach: 0, skipped: [] };

function loadPrefs(): Pick<GuideState, 'strategy' | 'minReach'> {
  try {
    const p = JSON.parse(localStorage.getItem('replab.guide') ?? '{}');
    return { strategy: p.strategy === 'line' ? 'line' : 'shallow', minReach: Number(p.minReach) || 0 };
  } catch {
    return { strategy: 'shallow', minReach: 0 };
  }
}

function setGuide(p: Partial<GuideState>) {
  useApp.setState((s) => ({ guide: { ...s.guide, ...p } }));
  const g = useApp.getState().guide;
  try {
    localStorage.setItem('replab.guide', JSON.stringify({ strategy: g.strategy, minReach: g.minReach }));
  } catch {
    /* egal */
  }
}

/** Zur nächsten passenden Lücke springen. */
export function guideNext(): boolean {
  const { graph, guide } = useApp.getState();
  if (!graph) return false;
  const gp = nextGap(graph, { strategy: guide.strategy, minReach: guide.minReach, skipped: new Set(guide.skipped), lastPath: guide.lastPath });
  if (!gp) {
    setGuide({ currentKey: undefined });
    return false;
  }
  gotoNode(gp.id);
  setGuide({ currentKey: gp.posKey, lastPath: pathUcis(graph, gp.id) });
  return true;
}

export function startGuide() {
  setGuide({ ...loadPrefs(), active: true, skipped: [], currentKey: undefined, lastPath: undefined });
  if (!guideNext()) toast('Keine offenen Lücken unter den aktuellen Filtern.', 'info');
}

export function stopGuide() {
  setGuide({ active: false, currentKey: undefined });
}

export function GuideBar() {
  const guide = useApp((s) => s.guide);
  const graph = useApp((s) => s.graph);
  const line = useApp((s) => s.line);
  const cursor = useApp((s) => s.cursor);
  const moves = useApp((s) => s.moves);
  const notation = useApp((s) => s.settings.ui.notation);
  const showReach = useApp((s) => s.settings.ui.showReach);
  const [waiting, setWaiting] = useState(false);
  const waitSince = useRef(0);

  const boardKey = posKeyOf(line[cursor].fen);
  const prevKey = cursor > 0 ? posKeyOf(line[cursor - 1].fen) : undefined;
  const gapId = guide.currentKey !== undefined ? graph?.byPosKey.get(guide.currentKey) : undefined;
  const gapNode = gapId !== undefined ? graph!.nodes[gapId] : undefined;
  const atGap = guide.currentKey === boardKey;
  const justLeft = guide.currentKey !== undefined && guide.currentKey === prevKey; // Zug am Brett gespielt
  const stillGap = gapNode?.status === 'gap';

  const open = useMemo(
    () => (graph ? openGapCount(graph, { minReach: guide.minReach, skipped: new Set(guide.skipped) }) : 0),
    [graph, guide.minReach, guide.skipped],
  );

  // Lücke geschlossen (Zug festgelegt, Ende-Marker, Gegnerzug ignoriert) → automatisch weiter
  useEffect(() => {
    if (!guide.active || !graph || !guide.currentKey || stillGap) return;
    if (!(atGap || justLeft)) return; // Nutzer erkundet frei → nicht wegspringen
    const entry = moves.get(guide.currentKey);
    // „In der Linie bleiben“: erst die Gegnerzüge nach meinem neuen Zug laden
    if (guide.strategy === 'line' && entry && gapNode) {
      let child;
      try {
        child = playUci(gapNode.fen, entry.uci);
      } catch {
        child = undefined;
      }
      const cid = child ? graph.byPosKey.get(child.posKey) : undefined;
      const cnode = cid !== undefined ? graph.nodes[cid] : undefined;
      if (child && cnode?.needsData && lichessToken()) {
        if (!waiting) {
          setWaiting(true);
          waitSince.current = Date.now();
          void explorer
            .get(child.fen, explorerParams(), { priority: 10 })
            .then(() => requestGraph(0))
            .catch(() => undefined);
        }
        if (Date.now() - waitSince.current < 8000) {
          const t = setTimeout(() => requestGraph(0), 1500);
          return () => clearTimeout(t);
        }
      }
    }
    setWaiting(false);
    const t = setTimeout(() => {
      if (!guideNext()) toast('Fertig – keine offenen Lücken mehr unter den aktuellen Filtern.', 'ok');
    }, 450);
    return () => clearTimeout(t);
  }, [guide.active, guide.currentKey, guide.strategy, graph, stillGap, atGap, justLeft, moves, gapNode, waiting]);

  if (!guide.active) return null;

  const siblings = gapId !== undefined && graph ? oppSiblings(graph, gapId) : [];
  const lastUci = gapNode?.uci;
  const parentKey = gapNode && gapNode.parent >= 0 ? graph!.nodes[gapNode.parent].posKey : undefined;
  const sans = gapNode && graph ? lineSans(graph, gapNode.id) : [];

  return (
    <div className="guide" data-testid="guide">
      <div className="guide-head">
        <b>Geführt: Lücken schließen</b>
        <span className="count gap" data-testid="guide-open">{open}</span>
        <select
          aria-label="Strategie"
          value={guide.strategy}
          onChange={(e) => setGuide({ strategy: e.target.value as GuideStrategy })}
        >
          <option value="shallow">flachste zuerst</option>
          <option value="line">in der Linie bleiben</option>
        </select>
        <select aria-label="Mindest-Erreichbarkeit" value={guide.minReach} onChange={(e) => setGuide({ minReach: Number(e.target.value), skipped: [] })}>
          <option value={0}>alle</option>
          <option value={0.001}>≥ 0,1 %</option>
          <option value={0.005}>≥ 0,5 %</option>
          <option value={0.01}>≥ 1 %</option>
          <option value={0.02}>≥ 2 %</option>
        </select>
        <button className="btn small ghost" onClick={stopGuide}>Beenden</button>
      </div>

      {!guide.currentKey ? (
        <p className="hint">
          {graph && graph.pending.length > 0 && lichessToken()
            ? `Keine offene Lücke – ${graph.pending.length} Stellungen laden noch Datenbank-Daten …`
            : 'Keine offene Lücke unter den aktuellen Filtern. 🎉'}{' '}
          <button className="link-btn" onClick={() => guideNext()}>erneut suchen</button>
        </p>
      ) : (
        <>
          <p className="guide-line">
            <span>{formatLine(sans, notation) || 'Grundstellung'}</span>
            {gapNode?.share !== undefined && <small> · Gegner spielt das in {(gapNode.share * 100).toFixed(0)} %</small>}
            {showReach && gapNode && gapNode.reach > 0 && <small> · erreicht ≈ {(gapNode.reach * 100).toFixed(1)} %</small>}
          </p>
          {waiting ? (
            <p className="hint">Lade die Gegnerzüge nach deinem neuen Zug …</p>
          ) : stillGap ? (
            <p className="hint">{atGap ? 'Du bist am Zug: analysieren und in der Tabelle „Festlegen“ (oder am Brett ziehen).' : 'Du hast die Lücke verlassen.'}</p>
          ) : null}
          <div className="row-actions wrap">
            {!atGap && (
              <button className="btn small" onClick={() => gapId !== undefined && gotoNode(gapId)}>
                Zurück zur Lücke
              </button>
            )}
            {stillGap && parentKey && lastUci && (
              <button
                className="btn small ghost"
                title="Dieser Gegnerzug ist für dich nicht relevant – die Linie endet davor"
                onClick={() => void toggleOpp(parentKey, lastUci, 'ignore', true)}
              >
                {lastUci && gapNode ? `${moveNumberPrefix(gapNode.ply - 1)}${displaySan(gapNode.san ?? '', notation)} ignorieren` : 'Gegnerzug ignorieren'}
              </button>
            )}
            {stillGap && (
              <button className="btn small ghost" title="Hier improvisierst du – keine Lücke mehr" onClick={() => void setEndOfLine(guide.currentKey!, true)}>
                Ende hier
              </button>
            )}
            <button
              className="btn small ghost"
              onClick={() => {
                setGuide({ skipped: [...guide.skipped, guide.currentKey!] });
                setTimeout(() => guideNext(), 0);
              }}
            >
              Überspringen
            </button>
          </div>
          {siblings.length > 1 && (
            <div className="guide-sibs">
              <span className="hint">Andere Gegnerzüge hier:</span>
              {siblings.map((s) => (
                <button
                  key={s.id}
                  className={`chip sib ${s.status} ${s.id === gapId ? 'on' : ''}`}
                  onClick={() => {
                    const n = graph!.nodes[s.id];
                    const target = n.status === 'transposition' ? n.transposeOf! : s.id;
                    gotoNode(target);
                    if (graph!.nodes[target].status === 'gap') setGuide({ currentKey: graph!.nodes[target].posKey, lastPath: pathUcis(graph!, target) });
                  }}
                  title={s.status === 'gap' ? 'Lücke' : s.status === 'answered' ? 'beantwortet' : s.status === 'end' ? 'Ende-Marker' : ''}
                >
                  {displaySan(s.san, notation)}
                  {s.share !== undefined && <small> {(s.share * 100).toFixed(0)} %</small>}
                  {s.status === 'gap' ? ' ●' : s.status === 'answered' ? ' ✓' : s.status === 'end' ? ' ■' : ''}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function lineSans(g: NonNullable<ReturnType<typeof useApp.getState>['graph']>, id: number): string[] {
  const out: string[] = [];
  for (let c = id; c > 0; c = g.nodes[c].parent) out.unshift(g.nodes[c].san!);
  return out;
}
