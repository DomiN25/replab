// PGN-Import mit Vorschau und Konfliktdialog (F9).
import { useMemo, useState } from 'react';
import { analyzePgn, planImport, pgnOrientation, type ExistingEntry } from '../core/pgn';
import { formatLine, displaySan } from '../core/chess';
import { repo } from '../data/repo';
import { lichessToken, loadRepData, reloadRepertoires, selectRepertoire, toast, useApp } from './store';
import { fetchStudyPgn, parseStudyUrl, studyName } from '../services/lichessStudy';

export interface ImportPreset {
  text: string;
  name: string;
  repId?: string;
  source?: 'pgn' | 'seed';
}

export function ImportDialog({ preset, onClose }: { preset?: ImportPreset; onClose: () => void }) {
  const repertoires = useApp((s) => s.repertoires);
  const notation = useApp((s) => s.settings.ui.notation);
  const [text, setText] = useState(preset?.text ?? '');
  const [name, setName] = useState(preset?.name ?? '');
  const orient = pgnOrientation(text);
  const defaultRep = preset?.repId ?? (repertoires.find((r) => r.color === orient && r.isMain) ?? repertoires.find((r) => r.id === useApp.getState().repId) ?? repertoires[0])?.id;
  const [repId, setRepId] = useState<string | undefined>(defaultRep);
  const [existing, setExisting] = useState<Map<string, ExistingEntry> | undefined>();
  const [resolutions, setResolutions] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [studyUrl, setStudyUrl] = useState('');
  const [loadingStudy, setLoadingStudy] = useState(false);
  const rep = repertoires.find((r) => r.id === repId);
  const studyRef = parseStudyUrl(studyUrl);

  const loadStudy = async () => {
    if (!studyRef) return;
    setLoadingStudy(true);
    try {
      const pgn = await fetchStudyPgn(studyRef, lichessToken() || undefined);
      setText(pgn);
      setName(studyName(pgn) ?? 'Lichess-Studie');
      const o = pgnOrientation(pgn);
      const match = o && repertoires.find((r) => r.color === o && r.isMain);
      if (match) setRepId(match.id);
      setExisting(undefined);
      toast(`Studie geladen${studyName(pgn) ? `: ${studyName(pgn)}` : ''}`, 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setLoadingStudy(false);
    }
  };

  const analyse = async () => {
    if (!repId) return;
    const moves = await repo.getMoves(repId);
    setExisting(new Map(moves.map((m) => [m.posKey, { uci: m.uci, san: m.san, note: m.note, tags: m.tags }])));
    setResolutions(new Map());
  };

  const analysis = useMemo(() => (existing && rep ? analyzePgn(text, rep.color, existing) : undefined), [existing, rep, text]);
  const plan = useMemo(() => {
    if (!existing || !rep || !analysis) return undefined;
    const res = new Map(analysis.conflicts.map((c) => [c.posKey, resolutions.get(c.posKey) ?? c.defaultUci]));
    return planImport(text, rep.color, existing, res);
  }, [existing, rep, analysis, resolutions, text]);

  const doImport = async () => {
    if (!plan || !repId) return;
    setBusy(true);
    try {
      await repo.applyImport(repId, plan, preset?.source ?? 'pgn');
      toast(`Import: +${plan.stats.newEntries} Einträge${plan.stats.replaced ? `, ${plan.stats.replaced} ersetzt` : ''}`, 'ok');
      await reloadRepertoires();
      if (useApp.getState().repId !== repId) await selectRepertoire(repId);
      else await loadRepData();
      onClose();
    } catch (e) {
      toast(`Import fehlgeschlagen: ${String(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setText(await f.text());
    setName(f.name);
    setExisting(undefined);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="PGN importieren" onClick={(e) => e.stopPropagation()}>
        <h2>PGN importieren {name && <small>{name}</small>}</h2>
        {!existing ? (
          <>
            <div className="field">
              <span>Lichess-Studie (Link)</span>
              <div className="row-actions" style={{ margin: 0 }}>
                <input
                  type="url"
                  inputMode="url"
                  value={studyUrl}
                  onChange={(e) => setStudyUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void loadStudy()}
                  placeholder="https://lichess.org/study/…"
                  aria-label="Lichess-Studienlink"
                />
                <button className="btn" disabled={!studyRef || loadingStudy} onClick={() => void loadStudy()}>
                  {loadingStudy ? 'Lädt …' : 'Laden'}
                </button>
              </div>
              {studyUrl && !studyRef && <small className="warn">Kein gültiger Studienlink.</small>}
            </div>
            <label className="field">
              <span>Datei</span>
              <input type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <label className="field">
              <span>oder PGN einfügen (mehrere Partien/Kapitel möglich)</span>
              <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="[Event &quot;…&quot;] 1. e4 e5 2. Nf3 …" />
            </label>
            <label className="field">
              <span>Ziel-Repertoire {orient && <small>(PGN-Orientierung: {orient === 'white' ? 'Weiß' : 'Schwarz'})</small>}</span>
              <select value={repId} onChange={(e) => setRepId(e.target.value)}>
                {repertoires.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.color === 'white' ? 'Weiß' : 'Schwarz'}){r.isMain ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Die Studie wird in das Ziel-Repertoire eingemischt: Züge der Repertoire-Farbe werden Einträge, Gegnerzüge werden als relevant markiert,
              Kommentare werden Notizen. Wo die Studie in einer Stellung etwas anderes spielt als dein Repertoire, fragt die Vorschau nach.
            </p>
            <div className="modal-actions">
              <button className="btn primary" disabled={!text.trim() || !repId} onClick={() => void analyse()}>Vorschau</button>
              <button className="btn ghost" onClick={onClose}>Abbrechen</button>
            </div>
          </>
        ) : (
          <>
            {plan && (
              <p className="preview">
                {plan.stats.games} Kapitel · <b className="me">+{plan.stats.newEntries} Einträge</b> · {analysis!.conflicts.length} Konflikte · {plan.stats.existing} bereits vorhanden
                {plan.stats.replaced > 0 && <> · <b className="warn">{plan.stats.replaced} ersetzt</b></>}
                {plan.stats.skipped > 0 && <> · {plan.stats.skipped} Äste übersprungen</>}
              </p>
            )}
            {analysis && analysis.conflicts.length > 0 && (
              <div className="conflicts">
                <h3>Konflikte – pro Stellung nur ein Zug</h3>
                {analysis.conflicts.map((c) => {
                  const chosen = resolutions.get(c.posKey) ?? c.defaultUci;
                  return (
                    <fieldset key={c.posKey} className="conflict">
                      <legend>{formatLine(c.sans, notation) || 'Grundstellung'}</legend>
                      {c.options.map((o) => (
                        <label key={o.uci} className="check">
                          <input
                            type="radio"
                            name={c.posKey}
                            checked={chosen === o.uci}
                            onChange={() => setResolutions(new Map(resolutions).set(c.posKey, o.uci))}
                          />
                          <b>{displaySan(o.san, notation)}</b> <small>{o.source === 'existing' ? 'vorhanden' : 'aus PGN'}</small>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
                <p className="hint">Der Ast des nicht gewählten Zugs wird übersprungen. Wählst du einen neuen Zug statt eines vorhandenen, verfällt dessen Lernstand.</p>
              </div>
            )}
            {analysis && analysis.otherColor > 0 && (
              <p className="notice">
                {analysis.otherColor} {analysis.otherColor === 1 ? 'Kapitel ist' : 'Kapitel sind'} für {rep?.color === 'white' ? 'Schwarz' : 'Weiß'} und{' '}
                {analysis.otherColor === 1 ? 'wird' : 'werden'} hier übersprungen – für diese Kapitel denselben Import mit einem{' '}
                {rep?.color === 'white' ? 'Schwarz' : 'Weiß'}-Repertoire als Ziel wiederholen.
              </p>
            )}
            {analysis && analysis.errors.length > 0 && (
              <div className="errors">
                <h3>Hinweise ({analysis.errors.length})</h3>
                <ul>{analysis.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn primary" disabled={busy || !plan} onClick={() => void doImport()}>Importieren</button>
              <button className="btn ghost" onClick={() => setExisting(undefined)}>Zurück</button>
              <button className="btn ghost" onClick={onClose}>Abbrechen</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
