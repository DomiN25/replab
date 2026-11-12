// „Inert“: Vorgeladene Nachbarseiten (Handy) sind gemountet, aber nicht aktiv – so liegen sie beim Wischen schon bereit.
// Inerte Seiten dürfen nichts anstoßen: keine Engine, keine Datenbank-Abfragen, keine Automatik, die Zustand verändert.
import { createContext, useContext } from 'react';

export const InertContext = createContext(false);
export const useInert = () => useContext(InertContext);
