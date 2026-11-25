// Zug zurücknehmen: Welche eigenen Einträge fallen mit einem Repertoirezug weg? Der Zug selbst plus alle Einträge, die danach
// nicht mehr erreichbar wären. Was über eine Zugumstellung weiter erreichbar ist, bleibt. UI-frei, getestet.
import type { Graph } from './graph';

/**
 * posKeys, die beim Zurücknehmen des eigenen Zugs in `posKey` gelöscht werden: zuerst `posKey` selbst, dann die abhängigen
 * Einträge (vorher erreichbar, ohne diesen Zug nicht mehr). Schon vorher verwaiste Einträge zählen nicht mit.
 */
export function takebackKeys(g: Graph, posKey: string, entryKeys: Iterable<string>): string[] {
  const reach = new Set<string>();
  const seen = new Set<number>();
  const stack = [0];
  while (stack.length) {
    let id = stack.pop()!;
    const t = g.nodes[id];
    if (t.status === 'transposition' && t.transposeOf !== undefined) id = t.transposeOf;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = g.nodes[id];
    reach.add(n.posKey);
    if (n.posKey === posKey) continue; // hier wird der eigene Zug entfernt – nichts dahinter ist über diesen Weg erreichbar
    for (const c of n.children) stack.push(c);
  }
  const out = [posKey];
  for (const k of entryKeys) if (k !== posKey && g.byPosKey.has(k) && !reach.has(k)) out.push(k);
  return out;
}
