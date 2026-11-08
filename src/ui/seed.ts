// Startrepertoire aus public/seed/ (Anhang A).
import { repo } from '../data/repo';
import { analyzePgn, planImport, pgnOrientation } from '../core/pgn';
import type { ImportPreset } from './ImportDialog';

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

/**
 * Mehrere PGN-Dateien laden (z. B. repertoire_weiss.pgn, repertoire_schwarz.pgn, studie_spanisch.pgn).
 * Farbe aus dem Orientation-Header → Hauptrepertoire dieser Farbe (wird bei Bedarf angelegt).
 * Dateien ohne Konflikte werden direkt übernommen, Dateien mit Konflikten kommen in den Importdialog.
 */
export async function importPgnFiles(files: File[]): Promise<{ imported: number; pending: ImportPreset[]; firstRepId?: string }> {
  // repertoire_* vor studie_*, damit Studien gegen das Repertoire geprüft werden
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  let imported = 0;
  let firstRepId: string | undefined;
  const pending: ImportPreset[] = [];
  for (const f of sorted) {
    const text = await f.text();
    const color = pgnOrientation(text) ?? 'white';
    const reps = await repo.listRepertoires();
    const rep =
      reps.find((r) => r.color === color && r.isMain) ??
      (await repo.createRepertoire(color === 'white' ? 'Hauptrepertoire Weiß' : 'Hauptrepertoire Schwarz', color));
    firstRepId ??= rep.id;
    const existing = new Map((await repo.getMoves(rep.id)).map((m) => [m.posKey, { uci: m.uci, san: m.san, note: m.note, tags: m.tags }]));
    const analysis = analyzePgn(text, color, existing);
    if (analysis.conflicts.length) {
      pending.push({ text, name: f.name, repId: rep.id, source: 'pgn' });
      continue;
    }
    const plan = planImport(text, color, existing);
    await repo.applyImport(rep.id, plan, 'pgn');
    imported += plan.stats.newEntries;
  }
  return { imported, pending, firstRepId };
}
