// „Auch heute fällig“: andere Repertoires und Studien mit fälligen Karten – auf der Startseite und der Trainingsseite.
// Ohne diese Zeilen sieht man Fälliges nur im gerade aktiven Repertoire bzw. erst nach dem Öffnen einer Studie.
import { selectRepertoire, setView, useApp } from './store';
import { Icon } from './Icon';

/** Auf den Graphen des frisch gewählten Repertoires warten (die Sitzung braucht die Zugwege), höchstens 4 s. */
function whenGraph(): Promise<void> {
  return new Promise((resolve) => {
    if (useApp.getState().graph) return resolve();
    const t = setTimeout(done, 4000);
    const off = useApp.subscribe((s) => s.graph && done());
    function done() {
      clearTimeout(t);
      off();
      resolve();
    }
  });
}

export function TodayRows({ autoStart }: { /** nach dem Wechsel gleich die Sitzung starten (Startseite) */ autoStart?: boolean }) {
  const today = useApp((s) => s.today);
  const repertoires = useApp((s) => s.repertoires);
  const repId = useApp((s) => s.repId);
  if (!today) return null;
  const reps = repertoires.filter((r) => r.id !== repId && (today.reps[r.id]?.due ?? 0) > 0);
  const studies = today.studies.filter((s) => s.due > 0);
  if (!reps.length && !studies.length) return null;

  const openRep = async (id: string) => {
    await selectRepertoire(id);
    if (!autoStart) return;
    await whenGraph();
    useApp.setState({ trainAuto: true });
    setView('train');
  };

  return (
    <div className="today-rows" data-testid="today-rows">
      <small className="today-h">Auch heute fällig</small>
      <ul>
        {reps.map((r) => (
          <li key={r.id}>
            <button className="today-row" onClick={() => void openRep(r.id)}>
              <span className={`kdot ${r.color}`} aria-hidden />
              <span className="today-name">{r.name}</span>
              <b>{today.reps[r.id].due}</b>
              <Icon name="next" />
            </button>
          </li>
        ))}
        {studies.map((s) => (
          <li key={s.id}>
            <button
              className="today-row"
              onClick={() => {
                useApp.setState({ studyId: s.id, studyCheck: true });
                setView('studies');
              }}
            >
              <Icon name="book" />
              <span className="today-name">
                {s.name} <small>Studie</small>
              </span>
              <b>{s.due}</b>
              <Icon name="next" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
