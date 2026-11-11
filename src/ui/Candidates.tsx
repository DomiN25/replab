// Kandidaten-Panel (F2): ich am Zug → Tabelle + Festlegen/Ändern + Notizen; Gegner am Zug → relevante Züge.
import { useMemo, useState } from 'react';
import { displaySan, moveNumberPrefix, plyOfFen, playUci, posKeyOf, formatLine } from '../core/chess';
import { formatEval, myCandidates, oppCandidates, standoutMove, type OppCandidate } from '../core/relevance';
import type { Graph, GNode } from '../core/graph';
import { pathSans } from '../core/graph';
import type { EngineLine, PositionMark, RepertoireMove } from '../core/types';
import { nameDe } from '../core/openings';
import type { ExplorerState, EngineState } from './hooks';
import { saveMoveMeta, setEndOfLine, toggleOpp, updateMark, useApp } from './store';
import { Icon } from './Icon';

interface Props {
  fen: string;
  myTurn: boolean;
  node?: GNode; // kanonischer Knoten dieser Stellung im Graphen
  graph?: Graph;
  lineSans: string[]; // aktueller Weg
  entry?: RepertoireMove;
  mark?: PositionMark;
  explorer: ExplorerState;
  masters: ExplorerState;
  engine: EngineState;
  source: 'lichess' | 'masters';
  onSource: (s: 'lichess' | 'masters') => void;
  onPlay: (uci: string) => void;
  onCommit: (uci: string, san: string) => void;
  onDeleteEntry: () => void;
}

const pct = (x?: number) => (x === undefined ? '–' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0).replace(".", ",")} %`);

function WdlBar({ w, d, l }: { w: number; d: number; l: number }) {
  const t = w + d + l || 1;
  return (
    <span className="wdl" title={`Weiß ${((w / t) * 100).toFixed(0)} % · Remis ${((d / t) * 100).toFixed(0)} % · Schwarz ${((l / t) * 100).toFixed(0)} %`}>
      <i className="w" style={{ width: `${(w / t) * 100}%` }} />
      <i className="d" style={{ width: `${(d / t) * 100}%` }} />
      <i className="b" style={{ width: `${(l / t) * 100}%` }} />
    </span>
  );
}

export function Candidates(p: Props) {
  const settings = useApp((s) => s.settings);
  const notation = settings.ui.notation;
  const ply = plyOfFenSafe(p.fen, p.lineSans.length);
  const ex = p.source === 'masters' ? p.masters : p.explorer;
  const engineData = useMemo(
    () => (p.engine.lines.length ? { posKey: posKeyOf(p.fen), depth: p.engine.depth, lines: p.engine.lines, analysedAt: 0 } : undefined),
    [p.engine, p.fen],
  );

  const transposed = useMemo(() => {
    if (!p.node || !p.graph) return undefined;
    const canonical = pathSans(p.graph, p.node.id);
    return canonical.join(' ') !== p.lineSans.join(' ') ? canonical : undefined;
  }, [p.node, p.graph, p.lineSans]);

  const opening = ex.data?.opening?.name ? nameDe(ex.data.opening.name) : p.node?.name;

  return (
    <div className="cands">
      <div className="cands-head">
        <div>
          <div className="turn">{p.myTurn ? 'Du bist am Zug' : 'Gegner am Zug'}</div>
          {opening && <div className="opening">{opening}</div>}
        </div>
      </div>

      {p.myTurn ? (
        <MyTurn {...p} ply={ply} engineLines={p.engine.lines} transposed={transposed} notation={notation} ex={ex} />
      ) : (
        <OppTurn {...p} ply={ply} engineData={engineData} notation={notation} ex={ex} />
      )}

      <EngineBox engine={p.engine} fen={p.fen} ply={ply} notation={notation} myTurn={p.myTurn} onPlay={p.onPlay} />
      <div className="cands-foot">
        <span className="hint">Datenbank</span>
        <div className="seg small" role="group" aria-label="Datenbank">
          <button aria-pressed={p.source === 'lichess'} onClick={() => p.onSource('lichess')}>Lichess</button>
          <button aria-pressed={p.source === 'masters'} onClick={() => p.onSource('masters')}>Meister</button>
        </div>
      </div>
    </div>
  );
}

function plyOfFenSafe(fen: string, fallback: number) {
  try {
    return plyOfFen(fen);
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------ Ich am Zug

function MyTurn(p: Props & { ply: number; engineLines: EngineLine[]; transposed?: string[]; notation: 'de' | 'en'; ex: ExplorerState }) {
  const rows = useMemo(
    () => myCandidates(p.fen, p.ex.data, p.engineLines.length ? { posKey: '', depth: 0, lines: p.engineLines, analysedAt: 0 } : undefined),
    [p.fen, p.ex.data, p.engineLines],
  );
  const posKey = posKeyOf(p.fen);
  const standout = useMemo(() => standoutMove(p.engineLines), [p.engineLines]);
  const isGap = p.node?.status === 'gap';
  const showAll = rows.slice(0, 12);
  const entryInRows = p.entry && rows.some((r) => r.uci === p.entry!.uci);

  return (
    <>
      <div className={`answer ${p.entry ? '' : 'missing'}`}>
        {p.entry ? (
          <>
            <div className="you">
              <span className="lbl">Dein Zug</span>
              <span className="mv">{moveNumberPrefix(p.ply) + displaySan(p.entry.san, p.notation)}</span>
              {(p.entry.tags ?? []).map((t) => (
                <span key={t} className={`badge ${t}`}>{t}</span>
              ))}
            </div>
            {p.transposed && (
              <div className="hint">⇄ über Zugumstellung erreicht – Hauptweg: {formatLine(p.transposed, p.notation) || 'Start'}</div>
            )}
          </>
        ) : p.mark?.endOfLine ? (
          <div className="you"><span className="lbl">■ Ende der Linie – hier improvisierst du</span></div>
        ) : (
          <div className="you">
            <span className="lbl">{isGap ? '● Lücke: noch kein Zug festgelegt' : 'Noch kein Zug festgelegt'}</span>
          </div>
        )}
      </div>

      {p.mark?.note && <p className="note">{p.mark.note}</p>}

      <ExplorerStatusLine ex={p.ex} engine={p.engine} fen={p.fen} ply={p.ply} notation={p.notation} myTurn={p.myTurn} onPlay={p.onPlay} />
      <div className="table-wrap">
        <table className="ctable">
          <thead>
            <tr>
              <th>Zug</th>
              <th className="num">Anteil</th>
              <th className="num hide-s">Partien</th>
              <th className="hide-s">W/R/S</th>
              <th className="num">Eval</th>
              <th className="num hide-s">Δ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {showAll.map((r) => {
              const mine = p.entry?.uci === r.uci;
              // Züge außerhalb der besten Engine-Linien: gezielt nachgerechnete Bewertung (etwas flacher)
              const more = r.cp === undefined && r.mate === undefined ? p.engine.extra.find((e) => e.uci === r.uci) : undefined;
              const myCp = r.cp ?? more?.cp;
              return (
                <tr key={r.uci} className={`${mine ? 'mine' : ''} ${standout === r.uci ? 'standout' : ''}`} title={standout === r.uci ? 'Mit Abstand der beste Zug (≥ 0,5 Vorsprung)' : undefined}>
                  <td>
                    <button className="mvbtn" onClick={() => p.onPlay(r.uci)} title="Zug am Brett ansehen">
                      {displaySan(r.san, p.notation)}
                    </button>
                  </td>
                  <td className="num">{pct(r.share)}</td>
                  <td className="num hide-s" title={r.games ? r.games.toLocaleString('de-DE') : undefined}>{r.games ? compactCount(r.games) : '–'}</td>
                  <td className="hide-s">{r.games ? <WdlBar w={r.white} d={r.draws} l={r.black} /> : null}</td>
                  <td className={`num ${more ? 'approx' : ''}`} title={more ? 'gezielt nachgerechnet (geringere Tiefe)' : undefined}>
                    {more ? '~' : ''}
                    {formatEval(myCp, r.mate ?? more?.mate)}
                  </td>
                  <td className="num hide-s">{r.deltaCp !== undefined ? (r.deltaCp === 0 ? '★' : `−${(r.deltaCp / 100).toFixed(2).replace('.', ',')}`) : ''}</td>
                  <td className="act">
                    {mine ? (
                      <span className="ok">✓</span>
                    ) : (
                      // „Ändern“ ist selten und folgenreich (Lernstand) → dezent; nur „Festlegen“ ist der Hauptknopf
                      <button className={`btn small ${p.entry ? 'ghost' : 'primary'}`} onClick={() => p.onCommit(r.uci, r.san)}>
                        {p.entry ? 'Ändern' : 'Festlegen'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {p.entry && !entryInRows && (
              <tr className="mine">
                <td>{displaySan(p.entry.san, p.notation)}</td>
                <td className="num">–</td>
                <td className="num hide-s">–</td>
                <td className="hide-s" />
                <td className="num">–</td>
                <td className="hide-s" />
                <td className="act"><span className="ok">✓</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!rows.length && !p.ex.loading && <p className="hint">Keine Daten. Zug am Brett spielen, um ihn festzulegen.</p>}

      {p.entry ? (
        <EntryEditor key={p.entry.id} entry={p.entry} onDelete={p.onDeleteEntry} />
      ) : (
        <div className="row-actions">
          <button className="btn small" onClick={() => void setEndOfLine(posKey, !p.mark?.endOfLine)}>
            {p.mark?.endOfLine ? 'Ende-Marker entfernen' : '■ Ende der Linie hier'}
          </button>
        </div>
      )}
      <LabelEditor posKey={posKey} mark={p.mark} />
    </>
  );
}

function EntryEditor({ entry, onDelete }: { entry: RepertoireMove; onDelete: () => void }) {
  const [note, setNote] = useState(entry.note ?? '');
  const [links, setLinks] = useState((entry.links ?? []).join('\n'));
  const [tagInput, setTagInput] = useState('');
  const tags = entry.tags ?? [];
  const toggleTag = (t: string) => {
    const depth = ['tief', 'mittel', 'flach'];
    let next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    if (depth.includes(t) && !tags.includes(t)) next = next.filter((x) => !depth.includes(x) || x === t);
    void saveMoveMeta(entry.id, { tags: next });
  };
  return (
    <div className="entry-edit">
      <label className="field">
        <span>Notiz / Pläne</span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (entry.note ?? '') && void saveMoveMeta(entry.id, { note })}
          placeholder="Pläne, Ideen, typische Fallen …"
        />
      </label>
      <label className="field">
        <span>Links (Studie/Kurs, eine pro Zeile)</span>
        <textarea
          rows={1}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          onBlur={() => {
            const arr = links.split(/\s+/).filter((x) => /^https?:\/\//.test(x));
            void saveMoveMeta(entry.id, { links: arr });
          }}
          placeholder="https://lichess.org/study/…"
        />
      </label>
      {(entry.links ?? []).length > 0 && (
        <div className="links">
          {entry.links!.map((l) => (
            <a key={l} href={l} target="_blank" rel="noreferrer noopener">{shortUrl(l)}</a>
          ))}
        </div>
      )}
      <div className="tags">
        {['tief', 'mittel', 'flach'].map((t) => (
          <button key={t} className={`chip ${tags.includes(t) ? 'on' : ''}`} aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>{t}</button>
        ))}
        {tags.filter((t) => !['tief', 'mittel', 'flach'].includes(t)).map((t) => (
          <button key={t} className="chip on" onClick={() => toggleTag(t)} title="Tag entfernen">{t} ×</button>
        ))}
        <input
          className="tag-input"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              toggleTag(tagInput.trim());
              setTagInput('');
            }
          }}
          placeholder="+ Tag"
          aria-label="Eigenen Tag hinzufügen"
        />
      </div>
      <div className="row-actions">
        <button className="btn small danger ghost" onClick={onDelete}>Zug entfernen</button>
      </div>
    </div>
  );
}

function LabelEditor({ posKey, mark }: { posKey: string; mark?: PositionMark }) {
  const [v, setV] = useState(mark?.label ?? '');
  const [edit, setEdit] = useState(false);
  if (!edit)
    return (
      <button className="link-btn" onClick={() => { setV(mark?.label ?? ''); setEdit(true); }}>
        {mark?.label ? `Stellungsname: ${mark.label} (ändern)` : '+ Namen für diese Stellung'}
      </button>
    );
  return (
    <div className="label-edit">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="z. B. Najdorf" aria-label="Name der Stellung" autoFocus />
      <button className="btn small" onClick={() => { void updateMark(posKey, { label: v.trim() || undefined }); setEdit(false); }}>Speichern</button>
    </div>
  );
}

function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return x.hostname.replace('www.', '') + x.pathname.slice(0, 24);
  } catch {
    return u;
  }
}

// ------------------------------------------------------------ Gegner am Zug

function OppTurn(p: Props & { ply: number; engineData?: { posKey: string; depth: number; lines: EngineLine[]; analysedAt: number }; notation: 'de' | 'en'; ex: ExplorerState }) {
  const settings = useApp((s) => s.settings);
  const moves = useApp((s) => s.moves);
  const marks = useApp((s) => s.marks);
  const posKey = posKeyOf(p.fen);
  const [showMore, setShowMore] = useState(false);
  const [menu, setMenu] = useState<string | undefined>();
  const cands = useMemo(
    () =>
      oppCandidates({
        fen: p.fen,
        explorer: p.source === 'lichess' ? p.ex.data : p.explorer.data,
        engine: p.engineData,
        mark: p.mark,
        settings: {
          minShare: settings.explorer.minShare,
          minGames: settings.explorer.minGames,
          nearBestCp: settings.engine.nearBestCp,
          trapLossCp: settings.engine.trapLossCp,
          trapMinShare: settings.engine.trapMinShare,
        },
      }),
    [p.fen, p.ex.data, p.explorer.data, p.engineData, p.mark, settings, p.source],
  );
  // Engine-Linien sind aus Sicht des Ziehenden (Gegner) sortiert
  const standout = useMemo(() => standoutMove(p.engineData?.lines ?? []), [p.engineData]);
  const relevant = cands.filter((c) => c.relevant);
  const others = cands.filter((c) => !c.relevant);

  const statusOf = (c: OppCandidate) => {
    let child;
    try {
      child = playUci(p.fen, c.uci);
    } catch {
      return { icon: '', cls: '', reach: undefined as number | undefined };
    }
    const g = p.graph;
    const gid = g?.byPosKey.get(child.posKey);
    const gn = gid !== undefined ? g!.nodes[gid] : undefined;
    if (marks.get(child.posKey)?.endOfLine) return { icon: '■', cls: 'end', reach: gn?.reach, childKey: child.posKey };
    if (moves.has(child.posKey)) return { icon: '✓', cls: 'ok', reach: gn?.reach, childKey: child.posKey };
    return { icon: c.relevant ? '●' : '', cls: 'gap', reach: gn?.reach, childKey: child.posKey };
  };

  const row = (c: OppCandidate) => {
    const st = statusOf(c);
    const more = c.moverCp === undefined ? p.engine.extra.find((e) => e.uci === c.uci) : undefined;
    const myCp = c.moverCp !== undefined ? -c.moverCp : more?.cp !== undefined ? -more.cp : undefined;
    return (
      <tr key={c.uci} className={`${c.relevant ? '' : 'dim'} ${standout === c.uci ? 'standout' : ''}`} title={standout === c.uci ? 'Stärkster Gegnerzug (≥ 0,5 Vorsprung)' : undefined}>
        <td>
          <button className="mvbtn opp" onClick={() => p.onPlay(c.uci)} title="Zug am Brett spielen">
            {displaySan(c.san, p.notation)}
          </button>
          {settings.ui.showTraps && c.trap && (
            <span className="trap" title={`Chance: verliert ca. ${((c.lossCp ?? 0) / 100).toFixed(1).replace('.', ',')} Bauern, gespielt in ${pct(c.share)} der Partien`}><Icon name="bolt" /></span>
          )}
        </td>
        <td className="num">{pct(c.share)}</td>
        <td className="num hide-s" title={c.games ? c.games.toLocaleString('de-DE') : undefined}>{c.games ? compactCount(c.games) : '–'}</td>
        <td className={`num ${more ? 'approx' : ''}`} title={more ? 'gezielt nachgerechnet (geringere Tiefe)' : undefined}>
          {more ? '~' : ''}
          {formatEval(myCp)}
        </td>
        <td className={`st ${st.cls}`} title={st.cls === 'ok' ? 'beantwortet' : st.cls === 'end' ? 'Ende-Marker' : 'Lücke'}>
          {st.cls === 'gap' && st.icon ? (
            <span className="st-gap-label">
              <Icon name="gap" /> Lücke
            </span>
          ) : (
            st.icon
          )}
        </td>
        {settings.ui.showReach && <td className="num reach hide-s">{st.reach ? `≈ ${(st.reach * 100).toFixed(1).replace(".", ",")} %` : ''}</td>}
        <td className="act">
          <div className="rowmenu">
            <button className="dots" aria-label={`Aktionen für ${c.san}`} aria-expanded={menu === c.uci} onClick={() => setMenu(menu === c.uci ? undefined : c.uci)}>
              <Icon name="dots" />
            </button>
            {menu === c.uci && (
              <div className="rowmenu-pop" role="menu" onClick={() => setMenu(undefined)}>
                {c.relevant ? (
                  <button role="menuitem" onClick={() => void toggleOpp(posKey, c.uci, 'ignore', true)}>Ignorieren (nicht relevant)</button>
                ) : c.ignored ? (
                  <button role="menuitem" onClick={() => void toggleOpp(posKey, c.uci, 'ignore', false)}>Wieder aufnehmen</button>
                ) : (
                  <button role="menuitem" onClick={() => void toggleOpp(posKey, c.uci, 'extra', true)}>Als relevant markieren</button>
                )}
                {st.childKey && (
                  <button role="menuitem" onClick={() => void setEndOfLine(st.childKey!, !marks.get(st.childKey!)?.endOfLine)}>
                    {marks.get(st.childKey)?.endOfLine ? 'Ende-Marker entfernen' : 'Ende der Linie danach'}
                  </button>
                )}
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <>
      {p.mark?.note && <p className="note">{p.mark.note}</p>}
      <ExplorerStatusLine ex={p.ex} engine={p.engine} fen={p.fen} ply={p.ply} notation={p.notation} myTurn={p.myTurn} onPlay={p.onPlay} />
      {p.mark?.endOfLine && <p className="hint">■ Ende-Marker: ab hier keine Lücken mehr.</p>}
      <div className="table-wrap">
        <table className="ctable">
          <thead>
            <tr>
              <th>Zug</th>
              <th className="num">Anteil</th>
              <th className="num hide-s">Partien</th>
              <th className="num">Eval</th>
              <th>Status</th>
              {settings.ui.showReach && <th className="num hide-s">Erreicht</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {relevant.map(row)}
            {showMore && others.map(row)}
          </tbody>
        </table>
      </div>
      {others.length > 0 && (
        <button className="link-btn" onClick={() => setShowMore(!showMore)}>
          {showMore ? 'weniger anzeigen' : `weitere Züge (${others.length})`}
        </button>
      )}
      {!relevant.length && !p.ex.loading && <p className="hint">Keine relevanten Gegnerzüge bekannt.</p>}
      <div className="row-actions">
        <button className="btn small" onClick={() => void setEndOfLine(posKey, !p.mark?.endOfLine)}>
          {p.mark?.endOfLine ? 'Ende-Marker entfernen' : '■ Ende der Linie hier'}
        </button>
      </div>
      <LabelEditor posKey={posKey} mark={p.mark} />
    </>
  );
}

/** Zeile über der Tabelle: Datenbank-Status und – direkt bei den Bewertungen – die aktuelle Stockfish-Tiefe. */
function ExplorerStatusLine({ ex, engine, ...pv }: { ex: ExplorerState; engine: EngineState } & Omit<PvProps, 'engine' | 'max'>) {
  const st = useApp((s) => s.explorerStatus);
  // Hauptvarianten direkt hier aufklappen (am Handy steht der Engine-Kasten sonst ganz unten im Blatt); pro Gerät gemerkt
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('replab.pv') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('replab.pv', open ? '0' : '1');
    } catch {
      /* privat/blockiert */
    }
  };
  const on = useApp((s) => s.engineOn);
  const warn = !!ex.error || (!ex.loading && st.state === 'backoff');
  const text = ex.loading
    ? 'Datenbank wird geladen …'
    : ex.error
      ? ex.error
      : st.state === 'backoff'
        ? 'Lichess-Limit erreicht – kurze Pause.'
        : ex.data && ex.data.total === 0
          ? 'Keine Partien in diesem Ratingband – nur Engine-Regel.'
          : ex.data
            ? `${ex.data.total.toLocaleString('de-DE')} Partien`
            : '';
  const eng =
    on && (engine.depth > 0 || engine.running) ? (
      <button className="eng-depth" data-testid="engine-depth" aria-expanded={open} onClick={toggle} title="Stockfish rechnet weiter, solange die Stellung offen ist – tippen zeigt die besten Linien">
        Stockfish Tiefe {engine.depth}
        {engine.running ? ' …' : ''}
        <Icon name="down" className={open ? 'up' : ''} />
      </button>
    ) : null;
  if (!text && !eng) return null;
  return (
    <>
      <p className={`hint ${warn ? 'warn' : ''}`}>
        {text}
        {text && eng ? ' · ' : ''}
        {eng}
      </p>
      {open && eng && (
        <div className="pv-top">
          <PvLines engine={engine} max={3} {...pv} />
        </div>
      )}
    </>
  );
}

interface PvProps {
  engine: EngineState;
  fen: string;
  ply: number;
  notation: 'de' | 'en';
  myTurn: boolean;
  onPlay: (u: string) => void;
  max: number;
}

/** Beste Engine-Linien (Bewertung aus meiner Sicht, erster Zug spielbar). */
function PvLines({ engine, fen, ply, notation, myTurn, onPlay, max }: PvProps) {
  const standout = standoutMove(engine.lines);
  return (
    <>
      {engine.lines.slice(0, max).map((l, i) => {
        const sign = myTurn ? 1 : -1;
        const cp = l.cp !== undefined ? l.cp * sign : undefined;
        const mate = l.mate !== undefined ? l.mate * sign : undefined;
        const sans = l.pv.length ? pvSans(fen, l.pv) : [l.san];
        return (
          <div key={i} className={`pv ${i === 0 && standout ? 'standout' : ''}`}>
            <span className="ev">{formatEval(cp, mate)}</span>
            <button className="mvbtn" onClick={() => onPlay(l.uci)}>{moveNumberPrefix(ply) + displaySan(l.san, notation)}</button>
            <span className="line">{formatLine(sans.slice(1, 8), notation, ply + 1)}</span>
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------ Engine

function EngineBox({ engine, fen, ply, notation, myTurn, onPlay }: { engine: EngineState; fen: string; ply: number; notation: 'de' | 'en'; myTurn: boolean; onPlay: (u: string) => void }) {
  const on = useApp((s) => s.engineOn);
  return (
    <div className="engine">
      <div className="engine-head">
        <button className="btn small ghost" aria-pressed={on} onClick={() => useApp.setState({ engineOn: !on })} title="Leertaste">
          Stockfish {on ? 'an' : 'aus'}
        </button>
        {on && (
          <span className="hint">
            Tiefe {engine.depth}
            {engine.running ? ' … rechnet weiter' : ''}
          </span>
        )}
      </div>
      {on && <PvLines engine={engine} fen={fen} ply={ply} notation={notation} myTurn={myTurn} onPlay={onPlay} max={5} />}
    </div>
  );
}

function pvSans(fen: string, pv: string[]): string[] {
  const out: string[] = [];
  let f = fen;
  for (const u of pv.slice(0, 9)) {
    try {
      const r = playUci(f, u);
      out.push(r.san);
      f = r.fen;
    } catch {
      break;
    }
  }
  return out;
}

/** Partienzahl kurz: 159 Mio. · 60 Tsd. · 842 (volle Zahl im Tooltip) – spart Breite in der Tabelle. */
export function compactCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: n >= 1e7 ? 0 : 1 })} Mio.`;
  if (n >= 1e4) return `${Math.round(n / 1e3).toLocaleString('de-DE')} Tsd.`;
  return n.toLocaleString('de-DE');
}
