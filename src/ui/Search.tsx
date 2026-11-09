// Suche im Repertoire: Eröffnung, eigener Stellungsname, Notiz oder Zugfolge – Treffer antippen springt hin.
import { useEffect, useMemo, useRef, useState } from 'react';
import { lineLabel, searchGraph, type SearchHit } from '../core/search';
import { gotoNode, useApp } from './store';
import { useBackClose } from './backClose';
import { trapFocus } from './Modal';
import { Icon } from './Icon';

const KIND_LABEL: Record<SearchHit['kind'], string> = { line: 'Zugfolge', label: 'Dein Name', name: 'Eröffnung', note: 'Notiz' };

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const graph = useApp((s) => s.graph);
  const moves = useApp((s) => s.moves);
  const marks = useApp((s) => s.marks);
  const notation = useApp((s) => s.settings.ui.notation);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useBackClose(true, onClose);
  useEffect(() => {
    box.current?.querySelector('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') trapFocus(e, box.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notes = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, e] of moves) if (e.note) m.set(k, e.note);
    for (const [k, mk] of marks) if (mk.note) m.set(k, (m.get(k) ? m.get(k) + ' · ' : '') + mk.note);
    return m;
  }, [moves, marks]);
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, mk] of marks) if (mk.label) m.set(k, mk.label);
    return m;
  }, [marks]);
  const hits = useMemo(() => (graph ? searchGraph(graph, q, { notes, labels }) : []), [graph, q, notes, labels]);

  const go = (id: number) => {
    gotoNode(id);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide search" role="dialog" aria-modal="true" aria-label="Im Repertoire suchen" ref={box} onClick={(e) => e.stopPropagation()}>
        <div className="search-field">
          <Icon name="search" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && hits[0] && go(hits[0].id)}
            placeholder="Eröffnung, Notiz oder Züge (z. B. „Lb5 a6“)"
            aria-label="Suchbegriff"
            enterKeyHint="go"
          />
        </div>
        {!graph ? (
          <p className="hint">Repertoire wird berechnet …</p>
        ) : q.trim().length < 2 ? (
          <p className="hint">
            Mindestens zwei Zeichen. Zugfolgen gehen deutsch oder englisch, mit oder ohne Zugnummer – gefunden wird die Stellung nach diesen Zügen.
          </p>
        ) : hits.length === 0 ? (
          <p className="hint">Nichts gefunden.</p>
        ) : (
          <ul className="search-hits">
            {hits.map((h) => {
              const n = graph.nodes[h.id];
              return (
                <li key={h.id}>
                  <button onClick={() => go(h.id)}>
                    <span className="sh-line">{lineLabel(graph, h.id, notation) || 'Grundstellung'}</span>
                    <span className="sh-meta">
                      <span className="tag">{KIND_LABEL[h.kind]}</span>
                      {h.kind !== 'line' && h.text ? <span className="sh-text">{h.text}</span> : n.name && <span className="sh-text">{n.name}</span>}
                      {n.status === 'gap' && <span className="tag gap">Lücke</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
