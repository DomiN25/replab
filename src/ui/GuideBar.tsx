// Lückentour (geführter Aufbau): bringt dich der Reihe nach zu den Lücken deines Repertoires.
// Du analysierst, legst deinen Zug fest – und es geht automatisch zur nächsten Lücke weiter.
// Reihenfolge: „Ast für Ast“ (ähnliche Linien hintereinander), „flachste zuerst“ oder „Linie zu Ende“.
import { useEffect, useMemo, useRef, useState } from 'react';
import { gapFamilies, nextGap, oppSiblings, openGapCount, type GuideStrategy } from '../core/guide';
import { pathUcis } from '../core/graph';
import { displaySan, formatLine, playUci, posKeyOf, moveNumberPrefix } from '../core/chess';
import { Icon } from './Icon';
import { useInert } from './inert';
import { explorer, explorerParams, gotoNode, lichessToken, requestGraph, setEndOfLine, toggleOpp, toast, useApp } from './store';

export interface GuideState {
  active: boolean;
  strategy: GuideStrategy;
  minReach: number;
  skipped: string[];
  currentKey?: string;
  lastPath?: string[];
  lastFamily?: string;
  /** Nur dieser Ast (Familie); leer = alle. */
  family?: string;
  /** Nur Lücken unterhalb dieser Stellung (posKey) – „ab hier weiterbauen“. */
  under?: string;
}

export const DEFAULT_GUIDE: GuideState = { active: false, strategy: 'branch', minReach: 0, skipped: [] };
const STRATEGIES: GuideStrategy[] = ['branch', 'shallow', 'line'];
const STRATEGY_LABEL: Record<GuideStrategy, string> = { branch: 'Ast für Ast', shallow: 'flachste zuerst', line: 'Linie zu Ende' };

function loadPrefs(): Pick<GuideState, 'strategy' | 'minReach'> {
  try {
    const p = JSON.parse(localStorage.getItem('replab.guide') ?? '{}');
    return { strategy: STRATEGIES.includes(p.strategy) ? p.strategy : 'branch', minReach: p.minReach !== undefined ? Number(p.minReach) || 0 : useApp.getState().settings.ui.gapMinReach };
  } catch {
    return { strategy: 'branch', minReach: useApp.getState().settings.ui.gapMinReach };
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

// „Überspringen“ merkt sich die Lücke 7 Tage (pro Gerät), sonst käme sie bei jedem Start der Tour wieder zuerst
const SNOOZE_MS = 7 * 24 * 3600 * 1000;
function snoozedKeys(): string[] {
  try {
    const m: Record<string, number> = JSON.parse(localStorage.getItem('replab.guideSnooze') ?? '{}');
    const now = Date.now();
    return Object.keys(m).filter((k) => m[k] > now);
  } catch {
    return [];
  }
}
function snooze(key: string) {
  try {
    const m: Record<string, number> = JSON.parse(localStorage.getItem('replab.guideSnooze') ?? '{}');
    const now = Date.now();
    for (const k of Object.keys(m)) if (m[k] <= now) delete m[k];
    m[key] = now + SNOOZE_MS;
    localStorage.setItem('replab.guideSnooze', JSON.stringify(m));
  } catch {
    /* egal */
  }
}

/** Zufall für den Start; die E2E-Tests setzen im Dev-Build `window.__replabRng` für feste Abläufe. */
function guideRng(): () => number {
  const hook = import.meta.env.DEV ? (window as unknown as { __replabRng?: () => number }).__replabRng : undefined;
  return hook ?? Math.random;
}

/** Zur nächsten passenden Lücke springen. `fresh`: Start einer Tour → erste Lücke variieren. */
export function guideNext(fresh = false): boolean {
  const { graph, guide } = useApp.getState();
  if (!graph) return false;
  const gp = nextGap(graph, {
    strategy: guide.strategy,
    minReach: guide.minReach,
    skipped: new Set(guide.skipped),
    lastPath: guide.lastPath,
    lastFamily: guide.lastFamily,
    family: guide.family,
    under: underId(graph, guide.under),
    rng: fresh ? guideRng() : undefined,
  });
  if (!gp) {
    setGuide({ currentKey: undefined });
    return false;
  }
  gotoNode(gp.id);
  setGuide({ currentKey: gp.posKey, lastPath: pathUcis(graph, gp.id), lastFamily: gp.branch });
  return true;
}

function underId(graph: NonNullable<ReturnType<typeof useApp.getState>['graph']>, key?: string): number | undefined {
  return key === undefined ? undefined : graph.byPosKey.get(key);
}

/** Lückentour starten; `under`: nur Lücken ab dieser Stellung (kritische Linie vertiefen). */
export function startGuide(family?: string, under?: string) {
  setGuide({ ...loadPrefs(), active: true, skipped: snoozedKeys(), currentKey: undefined, lastPath: undefined, lastFamily: undefined, family, under });
  if (!guideNext(true)) toast('Keine offenen Lücken unter den aktuellen Filtern.', 'info');
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
  const [showOpts, setShowOpts] = useState(() => {
    try {
      return localStorage.getItem('replab.guideOpts') === '1';
    } catch {
      return false;
    }
  });
  const toggleOpts = () => {
    const on = !showOpts;
    setShowOpts(on);
    try {
      localStorage.setItem('replab.guideOpts', on ? '1' : '0');
    } catch {
      /* privat/blockiert */
    }
  };
  const [waiting, setWaiting] = useState(false);
  const waitSince = useRef(0);
  const inert = useInert();

  const boardKey = posKeyOf(line[cursor].fen);
  const prevKey = cursor > 0 ? posKeyOf(line[cursor - 1].fen) : undefined;
  const gapId = guide.currentKey !== undefined ? graph?.byPosKey.get(guide.currentKey) : undefined;
  const gapNode = gapId !== undefined ? graph!.nodes[gapId] : undefined;
  const atGap = guide.currentKey === boardKey;
  const justLeft = guide.currentKey !== undefined && guide.currentKey === prevKey; // Zug am Brett gespielt
  const stillGap = gapNode?.status === 'gap';

  const open = useMemo(
    () => (graph ? openGapCount(graph, { minReach: guide.minReach, skipped: new Set(guide.skipped), family: guide.family, under: underId(graph, guide.under) }) : 0),
    [graph, guide.minReach, guide.skipped, guide.family, guide.under],
  );
  const families = useMemo(
    () => (graph ? gapFamilies(graph, { minReach: guide.minReach, skipped: new Set(guide.skipped), under: underId(graph, guide.under) }) : []),
    [graph, guide.minReach, guide.skipped, guide.under],
  );

  // Lücke geschlossen (Zug festgelegt, Ende-Marker, Gegnerzug ignoriert) → automatisch weiter
  useEffect(() => {
    if (inert || !guide.active || !graph || !guide.currentKey || stillGap) return;
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
        <span className="guide-title">
          <Icon name="tree" /> Lückentour
        </span>
        <span className="count gap" data-testid="guide-open" title="offene Lücken unter den aktuellen Filtern">
          {open}
        </span>
        <span className="guide-head-actions">
          <button
            className={`btn icon small ghost guide-gear ${showOpts ? 'on' : ''}`}
            aria-expanded={showOpts}
            aria-label="Tour einstellen"
            title="Reihenfolge, Ast und Mindest-Erreichbarkeit"
            onClick={toggleOpts}
            data-testid="guide-opts"
          >
            <Icon name="gear" />
          </button>
          <button className="btn small ghost" onClick={stopGuide}>
            Beenden
          </button>
        </span>
      </div>
      {showOpts ? (
        <div className="guide-opts">
          <label className="field inline">
            <span>Reihenfolge</span>
            <select aria-label="Strategie" value={guide.strategy} onChange={(e) => setGuide({ strategy: e.target.value as GuideStrategy })}>
              <option value="branch">Ast für Ast</option>
              <option value="shallow">flachste zuerst</option>
              <option value="line">Linie zu Ende</option>
            </select>
          </label>
          <label className="field inline">
            <span>Ast</span>
            <select
              aria-label="Ast"
              value={guide.family ?? ''}
              onChange={(e) => {
                setGuide({ family: e.target.value || undefined, skipped: snoozedKeys() });
                setTimeout(() => guideNext(), 0);
              }}
            >
              <option value="">alle Äste</option>
              {guide.family && !families.some((f) => f.family === guide.family) && <option value={guide.family}>{guide.family} (0)</option>}
              {families.map((f) => (
                <option key={f.family} value={f.family}>
                  {f.family} ({f.count})
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Erreichbarkeit</span>
            <select aria-label="Mindest-Erreichbarkeit" value={guide.minReach} onChange={(e) => setGuide({ minReach: Number(e.target.value), skipped: snoozedKeys() })}>
              <option value={0}>alle</option>
              <option value={0.001}>≥ 0,1 %</option>
              <option value={0.005}>≥ 0,5 %</option>
              <option value={0.01}>≥ 1 %</option>
              <option value={0.02}>≥ 2 %</option>
            </select>
          </label>
        </div>
      ) : (
        <button className="guide-sub" onClick={toggleOpts} title="Einstellungen öffnen">
          {STRATEGY_LABEL[guide.strategy]} · {guide.family ?? 'alle Äste'} · {guide.minReach > 0 ? `≥ ${String(guide.minReach * 100).replace('.', ',')} %` : 'alle Lücken'}
        </button>
      )}
      {guide.under !== undefined && graph && underId(graph, guide.under) !== undefined && (
        <p className="guide-focus" data-testid="guide-focus">
          <Icon name="tree" /> Nur ab: <b>{formatLine(lineSans(graph, underId(graph, guide.under)!), notation) || 'Grundstellung'}</b>
          <button
            className="link-btn"
            onClick={() => {
              setGuide({ under: undefined, skipped: snoozedKeys() });
              setTimeout(() => guideNext(), 0);
            }}
          >
            alle Äste
          </button>
        </p>
      )}

      {!guide.currentKey ? (
        <p className="hint">
          {graph && graph.pending.length > 0 && lichessToken()
            ? `Keine offene Lücke – ${graph.pending.length} Stellungen laden noch Datenbank-Daten …`
            : guide.family
              ? `Ast „${guide.family}“ ist fertig.`
              : 'Keine offene Lücke unter den aktuellen Filtern.'}{' '}
          <button className="link-btn" onClick={() => guideNext()}>erneut suchen</button>
        </p>
      ) : (
        <>
          <p className="guide-line">
            <span>{formatLine(sans, notation) || 'Grundstellung'}</span>
            {gapNode?.share !== undefined && <small> · Gegner spielt das in {(gapNode.share * 100).toFixed(0)} %</small>}
            {showReach && gapNode && gapNode.reach > 0 && <small> · erreicht ≈ {(gapNode.reach * 100).toFixed(1).replace(".", ",")} %</small>}
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
              title="Diese Lücke 7 Tage lang nicht mehr vorschlagen"
              onClick={() => {
                snooze(guide.currentKey!);
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
