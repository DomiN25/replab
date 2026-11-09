// Zahlen deutsch formatieren (Dezimalkomma) – überall gleich.

/** Anteil 0..1 als „0,5 %“, „12 %“ (ab 10 % ohne Nachkommastelle). */
export function pct(x: number, digits?: number): string {
  const v = x * 100;
  const d = digits ?? (v >= 10 || v === 0 ? 0 : v >= 1 ? 1 : 1);
  return `${v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
}
