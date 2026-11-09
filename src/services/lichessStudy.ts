// Lichess-Studie per Link laden: https://lichess.org/study/<id>[/<kapitel>] → PGN über die öffentliche API.
// Öffentliche Studien brauchen keinen Token; private nur mit Token (Scope „study:read“). Der Token wird nie geloggt.

export interface StudyRef {
  study: string;
  chapter?: string;
}

/** Link erkennen: lichess.org/study/ID, …/ID/KAPITEL, …/api/study/ID.pgn. (Keine nackte ID – „Spanisch“ sähe aus wie eine.) */
export function parseStudyUrl(input: string): StudyRef | undefined {
  const s = input.trim();
  const m = /lichess\.org\/(?:api\/)?study\/([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?/.exec(s);
  return m ? { study: m[1], chapter: m[2] } : undefined;
}

export function studyPgnUrl(ref: StudyRef): string {
  return ref.chapter
    ? `https://lichess.org/api/study/${ref.study}/${ref.chapter}.pgn`
    : `https://lichess.org/api/study/${ref.study}.pgn`;
}

/** Name der Studie aus dem ersten Kapitel ([StudyName "…"]). */
export function studyName(pgn: string): string | undefined {
  return /\[StudyName\s+"([^"]*)"\]/.exec(pgn)?.[1];
}

export async function fetchStudyPgn(ref: StudyRef, token?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let r = await fetch(studyPgnUrl(ref), { headers });
  // Ungültiger/zu schwacher Token: öffentliche Studie trotzdem ohne Token versuchen
  if ((r.status === 401 || r.status === 403) && token) r = await fetch(studyPgnUrl(ref));
  if (r.status === 404) throw new Error('Studie nicht gefunden – ist sie privat oder der Link falsch?');
  if (r.status === 401 || r.status === 403) throw new Error('Studie lässt sich nicht laden: privat oder der Autor hat den Export gesperrt. Eigene Studien auf Lichess öffentlich/„nicht gelistet“ stellen und Export erlauben.');
  if (r.status === 429) throw new Error('Lichess-Limit erreicht – bitte in einer Minute erneut versuchen.');
  if (!r.ok) throw new Error(`Lichess antwortet mit HTTP ${r.status}`);
  const text = await r.text();
  if (!text.trim().startsWith('[')) throw new Error('Antwort ist kein PGN.');
  return text;
}
