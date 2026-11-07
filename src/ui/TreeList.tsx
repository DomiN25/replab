// Listenansicht: einklappbarer Baum (Alternative zur Galaxie, gut fürs Handy).
import { useEffect, useMemo, useState } from 'react';
import type { Graph, GNode } from '../core/graph';
import { pathIds } from '../core/graph';
import { displaySan, moveNumberPrefix } from '../core/chess';
import { knowledgeOf } from '../core/srs';
import { KNOWLEDGE_COLORS } from './knowledge';

interface Props {
  graph: Graph;
  currentId?: number;
  notation: 'de' | 'en';
  showReach: boolean;
  rOf: (posKey: string) => number | undefined;
  onSelect: (id: number) => void;
}

const MAX_ROWS = 1500;

export function TreeList({ graph, currentId, notation, showReach, rOf, onSelect }: Props) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));

  // Pfad zur aktuellen Stellung immer aufklappen
  useEffect(() => {
    if (currentId === undefined) return;
    setOpen((o) => {
      const n = new Set(o);
      for (const id of pathIds(graph, currentId)) n.add(id);
      return n;
    });
  }, [graph, currentId]);

  const rows = useMemo(() => {
    const out: { n: GNode; depth: number }[] = [];
    const rec = (id: number, depth: number) => {
      if (out.length > MAX_ROWS) return;
      const n = graph.nodes[id];
      for (const c of n.children) {
        out.push({ n: graph.nodes[c], depth });
        if (open.has(c) && graph.nodes[c].status !== 'transposition') rec(c, depth + 1);
      }
    };
    rec(0, 0);
    return out;
  }, [graph, open]);

  const toggle = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const expandAll = () => setOpen(new Set(graph.nodes.map((n) => n.id)));
  const collapseAll = () => setOpen(new Set([0]));

  return (
    <div className="tree">
      <div className="tree-tools">
        <button className="btn ghost small" onClick={expandAll}>Alles aufklappen</button>
        <button className="btn ghost small" onClick={collapseAll}>Zuklappen</button>
      </div>
      <ul role="tree">
        {rows.map(({ n, depth }) => {
          const canon = n.status === 'transposition' ? graph.nodes[n.transposeOf!] : n;
          const parent = graph.nodes[n.parent];
          const hasKids = n.children.length > 0;
          const isOpen = open.has(n.id);
          const status =
            n.status === 'transposition' ? '⇄' : canon.status === 'gap' ? '●' : canon.status === 'end' ? '⏹' : canon.needsData ? '…' : '';
          const know = n.by === 'me' ? knowledgeOf(rOf(parent.posKey)) : undefined;
          const ownName = n.name && n.name !== parent.name ? n.name : '';
          return (
            <li
              key={n.id}
              role="treeitem"
              aria-expanded={hasKids ? isOpen : undefined}
              className={`tree-row ${n.by} ${n.id === currentId ? 'current' : ''} ${canon.status === 'gap' ? 'gap' : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              <button className="tw" aria-label={isOpen ? 'zuklappen' : 'aufklappen'} disabled={!hasKids} onClick={() => toggle(n.id)}>
                {hasKids ? (isOpen ? '▾' : '▸') : ''}
              </button>
              <button className="tm" onClick={() => onSelect(n.id)}>
                <span className="mv">{moveNumberPrefix(n.ply - 1) + displaySan(n.san ?? '', notation)}</span>
                {ownName && <span className="nm">{ownName}</span>}
              </button>
              {n.by === 'opp' && n.share !== undefined && <span className="sh">{(n.share * 100).toFixed(0)} %</span>}
              {showReach && n.by === 'opp' && canon.reach > 0 && <span className="reach">≈ {(canon.reach * 100).toFixed(1)} %</span>}
              {know && <i className="kn" style={{ background: KNOWLEDGE_COLORS[know] }} title={`Wissen: ${know}`} />}
              {status && <span className={`st st-${canon.status}`} title={n.status === 'transposition' ? 'Zugumstellung – Klick springt zur ersten Fundstelle' : canon.status}>{status}</span>}
            </li>
          );
        })}
      </ul>
      {rows.length > MAX_ROWS && <p className="hint">Liste gekürzt – bitte Äste zuklappen.</p>}
    </div>
  );
}
