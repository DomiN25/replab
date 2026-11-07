// Startrepertoire aus public/seed/ (Anhang A).
import { repo } from '../data/repo';
import { planImport } from '../core/pgn';

export async function fetchSeed(name: string): Promise<string> {
  const r = await fetch(new URL(`seed/${name}`, document.baseURI).href);
  const text = r.ok ? await r.text() : '';
  // Fehlt die Datei, liefert der Dev-Server index.html (200) bzw. Pages 404
  if (!r.ok || !text.trimStart().startsWith('[')) {
    throw new Error('Startrepertoire ist in dieser Version nicht enthalten (nur in der lokalen Entwicklungsversion).');
  }
  return text;
}

/** Sind die Seed-PGNs in dieser Version vorhanden? (In der veröffentlichten Version bewusst nicht.) */
export async function seedAvailable(): Promise<boolean> {
  try {
    await fetchSeed('repertoire_weiss.pgn');
    return true;
  } catch {
    return false;
  }
}

/** Legt „Hauptrepertoire Weiß/Schwarz“ an und importiert die beiden Repertoire-PGNs. */
export async function loadSeedRepertoires(): Promise<{ whiteId: string; blackId: string; entries: number }> {
  const reps = await repo.listRepertoires();
  const white = reps.find((r) => r.color === 'white' && r.isMain) ?? (await repo.createRepertoire('Hauptrepertoire Weiß', 'white'));
  const black = reps.find((r) => r.color === 'black' && r.isMain) ?? (await repo.createRepertoire('Hauptrepertoire Schwarz', 'black'));
  let entries = 0;
  for (const [rep, file] of [
    [white, 'repertoire_weiss.pgn'],
    [black, 'repertoire_schwarz.pgn'],
  ] as const) {
    const text = await fetchSeed(file);
    const existing = new Map((await repo.getMoves(rep.id)).map((m) => [m.posKey, { uci: m.uci, san: m.san, note: m.note, tags: m.tags }]));
    const plan = planImport(text, rep.color, existing);
    await repo.applyImport(rep.id, plan, 'seed');
    entries += plan.stats.newEntries;
  }
  return { whiteId: white.id, blackId: black.id, entries };
}
