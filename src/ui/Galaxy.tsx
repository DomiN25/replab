// Repertoire-Galaxie: zoombarer Sunburst. Mitte = aktuelle Stellung, nach außen 4 Halbzüge.
// Segmentbreite = Anteil (Explorer), < 3 % → „Rest“. Eigene Züge hell, Gegnerzüge gedämpft,
// Lücken roter Punkt, Zugumstellungen ⇄. Farbmodus Familie | Wissen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { arc as d3arc, color as d3color } from 'd3';
import type { Graph, GNode } from '../core/graph';
import { displaySan, moveNumberPrefix } from '../core/chess';
import { knowledgeOf } from '../core/srs';
import { knowledgeAgg, KNOWLEDGE_COLORS } from './knowledge';
import { prefersReducedMotion } from './hooks';

const PAL = ['#46e3ad', '#5aa9ff', '#f5b54a', '#c38bff', '#ff7aa8', '#7be0ff', '#ffd166', '#9be86f', '#ff9f5a', '#b8c4ff'];
const R = 300;
const RINGS = 4;
const RING = R / (RINGS + 1);
const MIN_SHARE = 0.03;

interface ArcDatum {
  key: string;
  id: number; // -1 = Rest
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  rest?: { ids: number[] };
}

/** Layout ab Fokus-Knoten: Winkel nach Anteil, 4 Ringe. */
export function layoutGalaxy(g: Graph, focusId: number, rings = RINGS): ArcDatum[] {
  const out: ArcDatum[] = [];
  const rec = (id: number, a0: number, a1: number, depth: number) => {
    if (depth > rings) return;
    const n = g.nodes[id];
    if (n.status === 'transposition' || !n.children.length) return;
    const kids = n.children.map((c) => g.nodes[c]);
    const known = n.toMove === 'opp' && kids.some((k) => (k.share ?? 0) > 0);
    let w = kids.map((k) => (known ? Math.max(k.share ?? 0, 0) : 1));
    let total = w.reduce((s, x) => s + x, 0) || 1;
    let f = w.map((x) => x / total);
    const small = known ? kids.map((_, i) => i).filter((i) => f[i] < MIN_SHARE) : [];
    const bundle = small.length >= 2;
    // Mindestbreite, damit einzelne kleine Segmente anklickbar bleiben
    w = f.map((x, i) => (bundle && small.includes(i) ? x : Math.max(x, 0.02)));
    total = w.reduce((s, x) => s + x, 0) || 1;
    f = w.map((x) => x / total);
    const span = a1 - a0;
    let a = a0;
    kids.forEach((k, i) => {
      if (bundle && small.includes(i)) return;
      const x0 = a;
      const x1 = a + f[i] * span;
      out.push({ key: String(k.id), id: k.id, x0, x1, y0: depth, y1: depth + 1 });
      rec(k.id, x0, x1, depth + 1);
      a = x1;
    });
    if (bundle) {
      const restF = small.reduce((s, i) => s + f[i], 0);
      out.push({ key: `rest-${id}`, id: -1, x0: a, x1: a + restF * span, y0: depth, y1: depth + 1, rest: { ids: small.map((i) => kids[i].id) } });
    }
  };
  rec(focusId, 0, 2 * Math.PI, 1);
  return out;
}

export interface GalaxyProps {
  graph: Graph;
  focusId: number;
  currentId?: number;
  mode: 'family' | 'knowledge';
  rOf: (posKey: string) => number | undefined;
  notation: 'de' | 'en';
  onSelect: (id: number) => void;
  onBack: () => void;
  outside?: boolean; // aktuelle Stellung liegt außerhalb des Repertoires
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Galaxy({ graph, focusId, currentId, mode, rOf, notation, onSelect, onBack, outside }: GalaxyProps) {
  const target = useMemo(() => layoutGalaxy(graph, focusId), [graph, focusId]);
  // Segmente sind an ihren Graphen gebunden: Knoten-IDs gelten nur für den Graphen, aus dem sie stammen.
  const [frame, setFrameRaw] = useState<{ arcs: (ArcDatum & { o: number })[]; graph: Graph }>({ arcs: target.map((a) => ({ ...a, o: 1 })), graph });
  const setFrame = (f: { arcs: (ArcDatum & { o: number })[] }) => setFrameRaw({ ...f, graph });
  const prev = useRef<Map<string, ArcDatum>>(new Map(target.map((a) => [a.key, a])));
  const prevFocus = useRef(focusId);
  const prevGraph = useRef(graph);
  // Bis der Effekt läuft: veraltete Segmente eines alten Graphen nie mit dem neuen Graphen zeichnen
  const arcs = frame.graph === graph ? frame.arcs : target.map((a) => ({ ...a, o: 1 }));

  // Animation zwischen altem und neuem Layout (≤ 650 ms, reduced-motion → sofort)
  useEffect(() => {
    const graphChanged = prevGraph.current !== graph;
    prevGraph.current = graph;
    // Neuer Graph (Neuberechnung im Hintergrund): IDs haben sich verschoben → ohne Animation neu
    const from = graphChanged ? new Map<string, ArcDatum>() : prev.current;
    const to = new Map(target.map((a) => [a.key, a]));
    const focusChanged = prevFocus.current !== focusId && !graphChanged;
    prevFocus.current = focusId;
    if (!focusChanged || prefersReducedMotion()) {
      prev.current = to;
      setFrame({ arcs: target.map((a) => ({ ...a, o: 1 })) });
      return;
    }
    const keys = new Set([...from.keys(), ...to.keys()]);
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = ease(t);
      const arcs: (ArcDatum & { o: number })[] = [];
      for (const k of keys) {
        const a = from.get(k);
        const b = to.get(k);
        if (a && b) arcs.push({ ...b, x0: lerp(a.x0, b.x0, e), x1: lerp(a.x1, b.x1, e), y0: lerp(a.y0, b.y0, e), y1: lerp(a.y1, b.y1, e), o: 1 });
        else if (b) arcs.push({ ...b, y0: lerp(b.y1, b.y0, e), o: e });
        else if (a) arcs.push({ ...a, y1: lerp(a.y1, a.y0, e), o: 1 - e });
      }
      if (t < 1) {
        setFrame({ arcs });
        raf = requestAnimationFrame(step);
      } else {
        // Ende: ausgeblendete Segmente entfernen
        prev.current = to;
        setFrame({ arcs: target.map((x) => ({ ...x, o: 1 })) });
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      prev.current = to;
    };
  }, [target, focusId]);

  const famColor = useMemo(() => {
    const fams = familyOrder(graph);
    return (f: string) => PAL[Math.max(0, fams.indexOf(f)) % PAL.length];
  }, [graph]);

  const agg = useMemo(() => (mode === 'knowledge' ? knowledgeAgg(graph, rOf) : undefined), [graph, mode, rOf]);

  const onPath = useMemo(() => {
    const s = new Set<number>();
    if (currentId === undefined) return s;
    for (let c = currentId; c >= 0 && c !== focusId; c = graph.nodes[c].parent) s.add(c);
    return s;
  }, [graph, currentId, focusId]);

  const arcGen = useMemo(
    () =>
      d3arc<ArcDatum>()
        .startAngle((d) => d.x0)
        .endAngle((d) => d.x1)
        .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.006))
        .padRadius(R * 1.5)
        .innerRadius((d) => d.y0 * RING)
        .outerRadius((d) => Math.max(d.y0 * RING, d.y1 * RING - 1.5)),
    [],
  );

  const fill = (d: ArcDatum): string => {
    if (d.id < 0) return '#3a465e';
    const n = graph.nodes[d.id];
    if (mode === 'knowledge' && agg) {
      if (n.by === 'me') {
        const parent = graph.nodes[n.parent];
        return KNOWLEDGE_COLORS[knowledgeOf(rOf(parent.posKey))];
      }
      const canon = n.status === 'transposition' ? graph.nodes[n.transposeOf!] : n;
      if (canon.status === 'gap') return 'url(#gapStripes)';
      const a = agg.get(canon.id);
      const k = knowledgeOf(a?.mean);
      return d3color(KNOWLEDGE_COLORS[k])!.darker(0.6).formatHex();
    }
    const base = d3color(famColor(n.topFamily))!;
    return n.by === 'me' ? base.formatHex() : base.darker(1.3).formatHex();
  };

  const label = (n: GNode) => moveNumberPrefix(n.ply - 1) + displaySan(n.san ?? '', notation);
  const focus = graph.nodes[focusId];
  const center = focusId === 0 ? 'Start' : label(focus);
  const sub = focus.name ?? '';

  return (
    <svg className="galaxy-svg" viewBox={`${-R - 10} ${-R - 10} ${2 * R + 20} ${2 * R + 20}`} role="img" aria-label="Repertoire-Galaxie">
      <defs>
        <pattern id="gapStripes" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#5a2330" />
          <rect width="4" height="8" fill="#ff6b6b" />
        </pattern>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <Stars />
      <g>
        {arcs.map((d) => {
          const n = d.id >= 0 ? graph.nodes[d.id] : undefined;
          const isPath = n && (onPath.has(n.id) || n.id === currentId);
          const title = n
            ? `${label(n)}${n.name ? ' – ' + n.name : ''}${n.share !== undefined && n.by === 'opp' ? ` · ${(n.share * 100).toFixed(1)} %` : ''}${statusText(graph, n)}`
            : `Rest: ${d.rest!.ids.map((i) => label(graph.nodes[i])).join(', ')}`;
          return (
            <path
              key={d.key}
              d={arcGen(d) ?? ''}
              fill={fill(d)}
              fillOpacity={(n?.by === 'me' ? 0.95 : 0.8) * d.o}
              stroke={isPath ? '#ffffff' : '#0b111d'}
              strokeWidth={isPath ? 2.2 : 0.6}
              style={{ cursor: n ? 'pointer' : 'default' }}
              onClick={() => n && onSelect(n.id)}
            >
              <title>{title}</title>
            </path>
          );
        })}
      </g>
      <g pointerEvents="none" textAnchor="middle">
        {arcs.map((d) => {
          if (d.id < 0) return null;
          const len = (d.x1 - d.x0) * ((d.y0 + d.y1) / 2) * RING;
          if (len < 24 || d.y1 - d.y0 < 0.6) return null;
          const n = graph.nodes[d.id];
          const ang = ((d.x0 + d.x1) / 2) * (180 / Math.PI);
          const rad = ((d.y0 + d.y1) / 2) * RING;
          const txt = (n.status === 'transposition' ? '⇄ ' : '') + displaySan(n.san ?? '', notation);
          return (
            <text
              key={'t' + d.key}
              transform={`rotate(${ang - 90}) translate(${rad},0) rotate(${ang < 180 ? 0 : 180})`}
              dy="0.35em"
              fontSize={len > 60 ? 13 : 11}
              fill={n.by === 'me' && mode === 'family' ? '#08121a' : '#e9eef6'}
              opacity={d.o}
            >
              {txt}
            </text>
          );
        })}
      </g>
      <g pointerEvents="none">
        {arcs.map((d) => {
          const ids = d.id >= 0 ? [d.id] : d.rest!.ids;
          const hasGap = ids.some((i) => {
            const n = graph.nodes[i];
            const c = n.status === 'transposition' ? graph.nodes[n.transposeOf!] : n;
            return c.status === 'gap';
          });
          if (!hasGap || d.y1 - d.y0 < 0.6) return null;
          const a = (d.x0 + d.x1) / 2 - Math.PI / 2;
          const r = d.y1 * RING - 6;
          return <circle key={'g' + d.key} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r={3.6} fill="#ff6b6b" filter="url(#glow)" opacity={d.o} />;
        })}
      </g>
      <g className="galaxy-center" onClick={onBack} style={{ cursor: focusId === 0 ? 'default' : 'pointer' }}>
        <circle r={RING - 4} fill="#101827" stroke="#26324a" />
        <text textAnchor="middle" dy="-0.15em" fontFamily="Sora, sans-serif" fontWeight={700} fontSize={22} fill="#46e3ad">
          {center}
        </text>
        <text textAnchor="middle" dy="1.5em" fontSize={10} fill="#8e9db4">
          {truncate(outside ? 'außerhalb' : sub, 18)}
        </text>
        {focusId !== 0 && (
          <text textAnchor="middle" dy="2.9em" fontSize={9} fill="#8e9db4">
            ↺ zurück
          </text>
        )}
        <title>{focusId === 0 ? 'Grundstellung' : 'Eine Ebene zurück'}</title>
      </g>
    </svg>
  );
}

function statusText(g: Graph, n: GNode): string {
  const c = n.status === 'transposition' ? g.nodes[n.transposeOf!] : n;
  if (n.status === 'transposition') return ' · ⇄ Zugumstellung';
  if (c.status === 'gap') return ' · ● Lücke';
  if (c.status === 'end') return ' · ⏹ Ende';
  return '';
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function Stars() {
  const stars = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 90 }, () => ({ x: (rnd() - 0.5) * 620, y: (rnd() - 0.5) * 620, r: rnd() * 1.2 + 0.2, o: rnd() * 0.5 + 0.1 }));
  }, []);
  return (
    <g>
      {stars.map((st, i) => (
        <circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#c9d3e3" opacity={st.o} />
      ))}
    </g>
  );
}

/** Familien der Ebene „nach 2 Halbzügen“ zuerst (Legende), danach übrige (z. B. eigener 1. Zug). */
function familyOrder(g: Graph): string[] {
  const main: string[] = [];
  const rest: string[] = [];
  for (const n of g.nodes) {
    if (n.ply === 2 && !main.includes(n.topFamily)) main.push(n.topFamily);
    else if ((n.ply === 1 || n.ply === 3) && !rest.includes(n.topFamily)) rest.push(n.topFamily);
  }
  return [...main, ...rest.filter((f) => !main.includes(f))];
}

export function GalaxyLegend({ mode, graph }: { mode: 'family' | 'knowledge'; graph: Graph }) {
  const fams = useMemo(() => familyOrder(graph), [graph]);
  const legendFams = useMemo(() => {
    const s = new Set<string>();
    for (const n of graph.nodes) if (n.ply === 2) s.add(n.topFamily);
    return fams.filter((f) => s.has(f));
  }, [graph, fams]);
  if (mode === 'knowledge')
    return (
      <div className="legend">
        <span><i style={{ background: KNOWLEDGE_COLORS.green }} />R ≥ 0,9</span>
        <span><i style={{ background: KNOWLEDGE_COLORS.yellow }} />0,7–0,9</span>
        <span><i style={{ background: KNOWLEDGE_COLORS.red }} />&lt; 0,7</span>
        <span><i style={{ background: KNOWLEDGE_COLORS.grey }} />neu</span>
        <span><i className="stripes" />Lücke</span>
      </div>
    );
  return (
    <div className="legend">
      {legendFams
        .filter((f) => f !== 'Repertoire')
        .slice(0, 12)
        .map((f) => (
          <span key={f}>
            <i style={{ background: PAL[fams.indexOf(f) % PAL.length] }} />
            {f}
          </span>
        ))}
      <span><i style={{ background: '#ff6b6b', borderRadius: '50%' }} />Lücke</span>
      <span>⇄ Zugumstellung</span>
    </div>
  );
}
