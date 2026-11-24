// Markierungen „Wichtig“ (Stern) und „Spannend“ (Blitz): umschalten (Repertoire und Training) und für die ganze Linie
// darunter anzeigen. Wichtige Linien fragt das Training öfter und zuerst ab (core/marks.ts, ui/training.ts).
import { useMemo } from 'react';
import { markedLines, type LineMarks } from '../core/marks';
import { Icon } from './Icon';
import { updateMark, useApp } from './store';

/** Markierte Linien des aktiven Repertoires (Stellung + Teilbaum). */
export function useLineMarks(): LineMarks {
  const graph = useApp((s) => s.graph);
  const marks = useApp((s) => s.marks);
  return useMemo(() => markedLines(graph, marks.values()), [graph, marks]);
}

/** Kleine Plaketten: diese Stellung liegt in einer wichtigen/spannenden Linie (auch geerbt von weiter oben). */
export function LineBadges({ posKey, lm }: { posKey: string; lm: LineMarks }) {
  const imp = lm.important.has(posKey);
  const sharp = lm.sharp.has(posKey);
  if (!imp && !sharp) return null;
  return (
    <span className="line-badges" data-testid="line-badges">
      {imp && (
        <span className="lb imp" title="Wichtige Linie – wird öfter abgefragt">
          <Icon name="star" /> Wichtig
        </span>
      )}
      {sharp && (
        <span className="lb sharp" title="Spannende Linie">
          <Icon name="bolt" /> Spannend
        </span>
      )}
    </span>
  );
}

/** Umschalter für die eigene Markierung dieser Stellung (gilt ab hier für die Linie darunter). */
export function MarkToggles({ posKey, compact }: { posKey: string; compact?: boolean }) {
  const mark = useApp((s) => s.marks.get(posKey));
  return (
    <>
      <button
        className={`btn small mark-btn ${mark?.critical ? 'on imp' : 'ghost'}`}
        aria-pressed={!!mark?.critical}
        onClick={() => void updateMark(posKey, { critical: !mark?.critical })}
        title="Wichtige Linie ab hier – wird im Training öfter und zuerst abgefragt"
        data-testid="crit-toggle"
      >
        <Icon name="star" /> {compact ? 'Wichtig' : mark?.critical ? 'Wichtig' : 'Als wichtig markieren'}
      </button>
      <button
        className={`btn small mark-btn ${mark?.sharp ? 'on sharp' : 'ghost'}`}
        aria-pressed={!!mark?.sharp}
        onClick={() => void updateMark(posKey, { sharp: !mark?.sharp })}
        title="Spannende Linie ab hier – zum Wiederfinden markieren"
        data-testid="sharp-toggle"
      >
        <Icon name="bolt" /> Spannend
      </button>
    </>
  );
}
