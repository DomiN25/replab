// Dünner Bilanz-Streifen unter dem Brett: wie liefen meine Partien, die durch diese Stellung gingen (Siege grün, Remis grau,
// Niederlagen rot). Nur sichtbar, wenn die Stellung in meinen geladenen Partien vorkam – klein und unaufdringlich.
import type { PosResult } from '../core/opponentStats';

export function ResultStrip({ r }: { r?: PosResult }) {
  if (!r || r.n === 0) return null;
  const label = `${r.n} ${r.n === 1 ? 'Partie' : 'Partien'} von dir mit dieser Stellung: ${r.w} gewonnen, ${r.d} remis, ${r.l} verloren`;
  return (
    <div className="res-strip" title={label} aria-label={label} data-testid="res-strip">
      <span className="rs-bar" aria-hidden>
        {r.w > 0 && <i className="w" style={{ flexGrow: r.w }} />}
        {r.d > 0 && <i className="d" style={{ flexGrow: r.d }} />}
        {r.l > 0 && <i className="l" style={{ flexGrow: r.l }} />}
      </span>
      <small>
        {r.n}× in deinen Partien · {Math.round((100 * (r.w + r.d / 2)) / r.n)} %
      </small>
    </div>
  );
}
