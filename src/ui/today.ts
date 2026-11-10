// „Heute“ über alle Repertoires und Studien: lädt die Daten und legt die Zählung in den Store (Logik: core/today.ts).
import { dueByRepertoire, studyDue, type DueCount } from '../core/today';
import type { ExistingEntry } from '../core/pgn';
import type { Color } from '../core/types';
import { repo } from '../data/repo';
import { useApp } from './store';

export interface TodayStudy extends DueCount {
  id: string;
  name: string;
  color: Color;
  linesDone: number;
}

export interface TodayState {
  /** Repertoire-ID → fällig/neu */
  reps: Record<string, DueCount>;
  studies: TodayStudy[];
}

let seq = 0;

/**
 * Zählung neu berechnen. Die Repertoire-Zahlen sind billig (ein Durchlauf über alle Karten). Die Studien brauchen
 * ggf. den Studienbaum – deshalb nur mit `withStudies` (Start, Startseite, Studienliste), sonst bleiben die alten Werte.
 */
export async function refreshToday(withStudies: boolean): Promise<void> {
  const mine = ++seq;
  const now = Date.now();
  const cards = await repo.db.cards.toArray();
  const reps = Object.fromEntries(dueByRepertoire(cards, now));
  let studies = useApp.getState().today?.studies;
  if (withStudies || !studies) {
    const list = await repo.listStudies();
    const repertoires = useApp.getState().repertoires;
    // Ziel-Repertoire wie in der Studienansicht: Hauptrepertoire der Studienfarbe, sonst irgendeins dieser Farbe
    const existing = new Map<Color, Map<string, ExistingEntry>>();
    const existingFor = async (color: Color) => {
      let m = existing.get(color);
      if (!m) {
        const r = repertoires.find((x) => x.color === color && x.isMain) ?? repertoires.find((x) => x.color === color);
        m = new Map(r ? (await repo.getMoves(r.id)).map((mv) => [mv.posKey, { uci: mv.uci, san: mv.san }]) : []);
        existing.set(color, m);
      }
      return m;
    };
    studies = [];
    for (const st of list) {
      let n: DueCount = { due: 0, fresh: 0 };
      try {
        n = studyDue(st, await existingFor(st.color), now);
      } catch {
        /* defektes PGN: Studie zählt nicht mit */
      }
      studies.push({ id: st.id, name: st.name, color: st.color, linesDone: st.linesDone?.length ?? 0, ...n });
    }
  }
  if (mine !== seq) return; // neuere Berechnung läuft schon
  useApp.setState({ today: { reps, studies } });
}
